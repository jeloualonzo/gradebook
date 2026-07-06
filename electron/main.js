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
const { app, BrowserWindow, utilityProcess, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { findFreePort, backupDatabase, waitForHttp } = require('./lib');

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

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // periodic push/pull while the app is open

// Cold starts are dominated by Windows re-reading thousands of server files
// from disk (often while the antivirus rescans them) — observed 6–15s on a
// real machine, potentially worse under load. The loading window below gives
// instant feedback; this timeout only cuts off genuinely broken starts.
const SERVER_START_TIMEOUT_MS = 90000;

/** Tiny window shown IMMEDIATELY on launch, replaced by the app when ready. */
function createLoadingWindow() {
  const w = new BrowserWindow({
    width: 360,
    height: 190,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Gradebook',
  });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <html><body style="font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:96vh;margin:0;color:#374151;background:#f9fafb">
      <div style="width:28px;height:28px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:s 1s linear infinite"></div>
      <p style="font-size:13px;font-weight:500;margin:14px 0 0">Starting Gradebook…</p>
      <p style="font-size:11px;color:#9ca3af;margin:4px 0 0">The first open after a while can take a minute</p>
      <style>@keyframes s{to{transform:rotate(360deg)}}</style>
    </body></html>`));
  return w;
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
  // Instant feedback: this window appears the moment the app launches and is
  // replaced by the gradebook once the server answers.
  const loadingWindow = createLoadingWindow();

  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const backupsDir = path.join(userData, 'backups');
  const logsDir = path.join(userData, 'logs');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(logsDir, 'server.log'), { flags: 'a' });
  const closeLoading = () => { try { if (!loadingWindow.isDestroyed()) loadingWindow.close(); } catch { /* gone */ } };

  // Automatic backup BEFORE the server opens the database.
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

  const ready = await waitForHttp(`http://127.0.0.1:${port}/`, SERVER_START_TIMEOUT_MS);
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Gradebook',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  closeLoading(); // the real window is up — retire the splash

  // Native folder picker for the sync settings dialog.
  ipcMain.handle('gradebook:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the shared sync folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

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
