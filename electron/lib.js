/**
 * Pure helpers for the Electron main process — no Electron imports, so these
 * are unit-testable with plain Node.
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const http = require('http');

/** Ask the OS for a free localhost port. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Copy the SQLite database trio (.sqlite / -wal / -shm) into a timestamped
 * backup folder, keeping only the newest `keep` backups.
 * Runs BEFORE the server opens the database, so the copy is consistent.
 * Returns the backup folder path, or null when there is nothing to back up.
 */
function backupDatabase(dataDir, backupsDir, keep = 14) {
  const dbFile = path.join(dataDir, 'gradebook.sqlite');
  if (!fs.existsSync(dbFile)) return null; // first run
  fs.mkdirSync(backupsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(backupsDir, stamp);
  fs.mkdirSync(destDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbFile + suffix;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, path.basename(src)));
    }
  }

  // Rotate: folder names are ISO timestamps, so a lexical sort is chronological.
  const entries = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
  while (entries.length > keep) {
    const oldest = entries.shift();
    fs.rmSync(path.join(backupsDir, oldest), { recursive: true, force: true });
  }
  return destDir;
}

/** Poll an HTTP URL until it answers (any status) or the timeout elapses. */
function waitForHttp(url, timeoutMs = 20000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const attempt = () => {
      const req = http.get(url, res => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

module.exports = { findFreePort, backupDatabase, waitForHttp };
