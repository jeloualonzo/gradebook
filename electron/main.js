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

let serverProc = null;
let mainWindow = null;
let logStream = null;

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
    fatal(`Server bundle not found at:\n${serverJs}\n\nBuild it first: npm run desktop:build`);
    return;
  }

  const port = await findFreePort();
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
      GRADEBOOK_SCHEMA_PATH: path.join(serverRoot, 'schema.sql'),
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

  const ready = await waitForHttp(`http://127.0.0.1:${port}/`, 25000);
  if (!ready) {
    fatal(`The gradebook server did not start in time.\nSee logs at: ${path.join(logsDir, 'server.log')}`);
    return;
  }

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

  // Native folder picker for the sync settings dialog.
  ipcMain.handle('gradebook:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the shared sync folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Fire-and-forget sync on launch (no-op until a sync folder is configured;
  // failures only log — the gradebook never waits on sync).
  const req = http.request(
    { host: '127.0.0.1', port, path: '/api/sync/run', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => log(`Launch sync (${res.statusCode}): ${body.slice(0, 300)}`));
    }
  );
  req.on('error', err => log(`Launch sync skipped: ${err.message}`));
  req.end('{}');

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

app.on('quit', () => {
  app.isQuittingForReal = true;
  try {
    serverProc?.kill();
  } catch {
    /* already gone */
  }
});
