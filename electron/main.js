/**
 * Gradebook desktop shell.
 *
 * The main process boots the bundled Next.js server (built with
 * `output: 'standalone'`) as a utility child process on a free localhost
 * port, then opens a window pointing at it. The web app itself is untouched —
 * every API route and UI feature runs exactly as in the browser version.
 *
 * Storage lives in the OS app-data folder:
 *   <userData>/data/gradebook.sqlite   — the database (one file)
 *   <userData>/data/device.json        — this laptop's identity
 *   <userData>/backups/<timestamp>/    — automatic launch backups (kept: 14)
 *   <userData>/logs/server.log         — server output for diagnostics
 */
const { app, BrowserWindow, utilityProcess, dialog, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { findFreePort, backupDatabase, waitForHttp } = require('./lib');
const { createWindowState } = require('./window-state');

const BACKUPS_TO_KEEP = 14;

// Store data under %APPDATA%/Gradebook (matches the product name and docs) —
// by default Electron would use the package.json name ("grading-system").
app.setPath('userData', path.join(app.getPath('appData'), 'Gradebook'));

let serverProc = null;
let mainWindow = null;
let logStream = null;
let serverPort = null;
let syncTimer = null;
let syncInFlight = false;
let quitSyncDone = false;

// ---- Automatic updates (GitHub Releases via electron-updater) --------------
// The app checks GitHub for a newer release, downloads it in the background,
// and installs on "Restart and Update" (or on normal quit). Offline checks
// fail silently — being offline is a normal state for this app.
let autoUpdater = null;
let updateStatus = { state: 'idle', version: null, percent: null, error: null };
const setUpdateStatus = (patch) => { updateStatus = { ...updateStatus, ...patch }; };

function setupAutoUpdates() {
  if (!app.isPackaged) return; // dev runs never self-update
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log(`Updater unavailable: ${err.message}`);
    return;
  }
  autoUpdater.autoDownload = true;           // download in the background
  autoUpdater.autoInstallOnAppQuit = true;   // closing the app applies it too
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking', error: null }));
  autoUpdater.on('update-available', info => setUpdateStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', p => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', info => setUpdateStatus({ state: 'downloaded', version: info.version, percent: 100 }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'uptodate', checked_at: new Date().toISOString() }));
  autoUpdater.on('error', err => {
    log(`Update check failed (offline is fine): ${err?.message || err}`);
    setUpdateStatus({ state: 'error', error: String(err?.message || err) });
  });

  // First check shortly after boot (never competing with startup), then every 4h.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // periodic push/pull while the app is open

// Cold starts are dominated by Windows re-reading thousands of server files
// from disk (often while the antivirus rescans them) — observed 6–15s on a
// real machine, potentially worse under load. The loading window below gives
// instant feedback; this timeout only cuts off genuinely broken starts.
const SERVER_START_TIMEOUT_MS = 90000;

/**
 * Splash window — shown IMMEDIATELY on launch, cross-faded into the app when
 * the server answers. The content (electron/splash.html, artwork embedded as
 * base64) paints with zero disk/network dependencies. Stage text is REAL:
 * the main process reports what it is actually doing; nothing is faked
 * (ROADMAP.md Phase 1, Appendix A-1).
 */
function createSplashWindow(dataDir) {
  const w = new BrowserWindow({
    width: 720,
    height: 440,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    backgroundColor: '#faf7f2', // the artwork's paper white — no flash before paint
    title: 'Gradebook',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  w.loadFile(path.join(__dirname, 'splash.html'));

  // Stage calls can arrive before the splash finishes loading — buffer the
  // latest one and replay it (plus version/device) once the page is ready.
  let ready = false;
  let pendingStage = 'Preparing…';
  const run = (code) => {
    try {
      if (!w.isDestroyed()) w.webContents.executeJavaScript(code).catch(() => {});
    } catch { /* window already gone — never let the splash break boot */ }
  };
  w.webContents.on('did-finish-load', () => {
    ready = true;
    let device = null;
    try {
      device = JSON.parse(fs.readFileSync(path.join(dataDir, 'device.json'), 'utf8')).device_label || null;
    } catch { /* first run — no identity yet */ }
    run(`splashInit(${JSON.stringify({ version: app.getVersion(), device })})`);
    run(`setStage(${JSON.stringify(pendingStage)})`);
  });

  return {
    window: w,
    stage(text) {
      pendingStage = text;
      if (ready) run(`setStage(${JSON.stringify(text)})`);
    },
    fadeOut() {
      run('fadeOut()');
    },
    close() {
      try { if (!w.isDestroyed()) w.close(); } catch { /* gone */ }
    },
  };
}

/**
 * Ask the local server to run one sync pass. Resolves with the response body
 * (or null on error/timeout) — NEVER rejects, so callers can fire-and-forget.
 */
function requestSync(timeoutMs = 15000, reason = 'periodic') {
  return new Promise(resolve => {
    if (!serverPort) return resolve(null);
    if (syncInFlight) return resolve(null);
    syncInFlight = true;
    const done = (body) => { syncInFlight = false; resolve(body); };
    const req = http.request(
      { host: '127.0.0.1', port: serverPort, path: '/api/sync/run', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => { log(`Sync (${reason}, ${res.statusCode}): ${body.slice(0, 300)}`); done(body); });
      }
    );
    req.setTimeout(timeoutMs, () => { log(`Sync (${reason}) timed out`); req.destroy(); done(null); });
    req.on('error', err => { log(`Sync (${reason}) skipped: ${err.message}`); done(null); });
    req.end('{}');
  });
}

function fatal(message) {
  try {
    dialog.showErrorBox('Gradebook could not start', String(message));
  } catch {
    console.error(message);
  }
  app.quit();
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}\n`;
  try {
    logStream?.write(msg);
  } catch {
    /* logging must never crash the app */
  }
}

async function start() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const backupsDir = path.join(userData, 'backups');
  const logsDir = path.join(userData, 'logs');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(logsDir, 'server.log'), { flags: 'a' });

  // Instant feedback: the splash appears the moment the app launches and is
  // cross-faded into the gradebook once the server answers.
  const splash = createSplashWindow(dataDir);
  const closeLoading = () => splash.close();

  // Automatic backup BEFORE the server opens the database.
  splash.stage('Backing up your data…');
  try {
    const dest = backupDatabase(dataDir, backupsDir, BACKUPS_TO_KEEP);
    if (dest) log(`Backup created: ${dest}`);
  } catch (err) {
    log(`Backup failed (continuing): ${err.message}`);
  }

  // Locate the bundled server (packaged) or the local build (development).
  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', '.next', 'standalone');
  const serverJs = path.join(serverRoot, 'server.js');
  if (!fs.existsSync(serverJs)) {
    closeLoading();
    fatal(`Server bundle not found at:\n${serverJs}\n\nBuild it first: npm run desktop:build`);
    return;
  }

  const port = await findFreePort();
  const bootStartedAt = Date.now();
  log(`Starting server from ${serverRoot} on port ${port}`);
  splash.stage('Starting your workspace…');

  serverProc = utilityProcess.fork(serverJs, [], {
    cwd: serverRoot,
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      GRADEBOOK_DATA_DIR: dataDir,
    },
  });
  serverProc.stdout?.on('data', d => log(`[server] ${String(d).trimEnd()}`));
  serverProc.stderr?.on('data', d => log(`[server:err] ${String(d).trimEnd()}`));
  serverProc.on('exit', code => {
    log(`Server exited with code ${code}`);
    if (mainWindow && !app.isQuittingForReal) {
      fatal(`The gradebook server stopped unexpectedly (code ${code}).\nSee logs at: ${path.join(logsDir, 'server.log')}`);
    }
  });

  // Honest waiting: after a few seconds, the stage line starts reporting
  // elapsed time — cold starts under antivirus rescans really do take a
  // while, and a counting number reads as alive where a frozen line reads
  // as hung.
  const waitTicker = setInterval(() => {
    const s = Math.round((Date.now() - bootStartedAt) / 1000);
    if (s >= 8) splash.stage(`Starting your workspace… ${s}s — a cold start can take a minute`);
  }, 3000);
  const ready = await waitForHttp(`http://127.0.0.1:${port}/`, SERVER_START_TIMEOUT_MS);
  clearInterval(waitTicker);
  if (!ready) {
    closeLoading();
    fatal(
      'The gradebook server did not start within 90 seconds.\n\n' +
      'This is usually a one-off (a very slow cold start, often the antivirus scanning the app) — ' +
      'try opening Gradebook again.\n\n' +
      `If it keeps happening, send the log file:\n${path.join(logsDir, 'server.log')}`
    );
    return;
  }
  log(`Server ready after ${Date.now() - bootStartedAt}ms`);
  splash.stage('Restoring your session…');

  // Restore last session's window geometry, maximized state, and zoom —
  // and keep tracking them from here on (VS Code-style). State lives in
  // <userData>/window-state.json; off-screen positions are sanitized.
  const winState = createWindowState({
    file: path.join(userData, 'window-state.json'),
    defaults: { width: 1280, height: 820 },
    screen,
  });
  mainWindow = new BrowserWindow({
    ...winState.windowOptions(),
    show: false, // revealed by the splash cross-fade below
    title: 'Gradebook',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // deferMaximize: maximize() would force-show the hidden window; the
  // remembered maximized state is applied by showManaged() at reveal time.
  winState.manage(mainWindow, { deferMaximize: true });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // Seamless handoff: wait for the app's first paint, fade the splash out,
  // then reveal the main window exactly as the splash disappears. The
  // timeout is a safety net — the app must NEVER stay hidden.
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    splash.stage('Ready');
    splash.fadeOut();
    setTimeout(() => {
      closeLoading();
      winState.showManaged();
    }, 240);
  };
  mainWindow.once('ready-to-show', reveal);
  setTimeout(reveal, 10000);

  // Native folder picker for the sync settings dialog.
  ipcMain.handle('gradebook:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the shared sync folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Open the automatic-backups folder in Explorer (Settings → Backups).
  ipcMain.handle('gradebook:open-backups', async () => {
    fs.mkdirSync(backupsDir, { recursive: true });
    return shell.openPath(backupsDir);
  });

  // ---- Update IPC (Settings → General + the status bar) --------------------
  ipcMain.handle('gradebook:update-status', () => ({ ...updateStatus, current: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('gradebook:check-updates', async () => {
    if (autoUpdater) {
      try { await autoUpdater.checkForUpdates(); } catch { /* status carries the error */ }
    }
    return { ...updateStatus, current: app.getVersion(), packaged: app.isPackaged };
  });
  ipcMain.handle('gradebook:install-update', async () => {
    if (!autoUpdater || updateStatus.state !== 'downloaded') return false;
    // Publish this session's work first, then hand over to the installer —
    // and mark the quit sync as done so before-quit doesn't intercept.
    await requestSync(6000, 'pre-update');
    quitSyncDone = true;
    if (syncTimer) clearInterval(syncTimer);
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  setupAutoUpdates();

  // Sync lifecycle (all no-ops until a sync folder is configured; failures
  // only log — the gradebook never waits on sync):
  //  · on launch:   pick up the other laptop's work before you start
  //  · every 5 min: hand off changes while the app sits open (cheap — an
  //                 unchanged database skips the export entirely)
  //  · on quit:     publish today's work the moment you close the app
  // Together these make "switch laptops whenever" safe: the laptop you leave
  // has published, the one you open pulls first.
  serverPort = port;
  requestSync(15000, 'launch');
  syncTimer = setInterval(() => requestSync(30000, 'periodic'), SYNC_INTERVAL_MS);

  // Internal navigation stays in-window; anything external opens in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance: launching a second copy focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => start().catch(err => fatal(err?.stack || err)));
}

app.on('window-all-closed', () => {
  app.quit();
});

// Final sync on quit: hold the shutdown just long enough to publish this
// session's work (bounded — a dead folder can only delay quitting ~6s).
app.on('before-quit', (event) => {
  if (quitSyncDone || !serverPort) return;
  quitSyncDone = true;
  event.preventDefault();
  if (syncTimer) clearInterval(syncTimer);
  requestSync(6000, 'quit').finally(() => app.quit());
});

app.on('quit', () => {
  app.isQuittingForReal = true;
  if (syncTimer) clearInterval(syncTimer);
  try {
    serverProc?.kill();
  } catch {
    /* already gone */
  }
});
