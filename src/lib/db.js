import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runMigrations } from './migrations';

/**
 * SQLite storage engine — zero configuration by design.
 *
 * - The database is a single file in the data directory (default: ./data,
 *   overridable with GRADEBOOK_DATA_DIR — the Electron shell points this at
 *   the OS app-data folder).
 * - The schema bootstraps itself on first open (CREATE TABLE IF NOT EXISTS),
 *   so there is nothing to install, configure, or migrate by hand.
 * - device.json holds this installation's identity (a generated device id and
 *   a friendly label). It lives NEXT TO the database on purpose: identity
 *   belongs to the installation, not inside the synced data.
 */

const dataDir = process.env.GRADEBOOK_DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'gradebook.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Bootstrap / upgrade schema. In the packaged desktop app the schema file
// lives next to the bundled server, located via GRADEBOOK_SCHEMA_PATH.
// (turbopackIgnore keeps the tracer from pulling the whole project into the
// standalone bundle because of this dynamic path.)
const schemaPath =
  process.env.GRADEBOOK_SCHEMA_PATH ||
  path.join(/* turbopackIgnore: true */ process.cwd(), 'src/lib/schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));
// Upgrade older databases in place (see src/lib/migrations.js) — this is
// what makes app updates safe over real data.
runMigrations(db);

// ---- Device identity (no accounts — one generated id per installation) ----
const devicePath = path.join(dataDir, 'device.json');

function loadDevice() {
  try {
    const parsed = JSON.parse(fs.readFileSync(devicePath, 'utf8'));
    if (parsed?.device_id) return parsed;
  } catch {
    /* first run */
  }
  const device = { device_id: crypto.randomUUID(), device_label: null };
  fs.writeFileSync(devicePath, JSON.stringify(device, null, 2));
  return device;
}

const device = loadDevice();

// ---- Small, explicit query API (used only by src/lib/queries/*) -----------
const api = {
  /** All rows for a SELECT. */
  all(sql, params = []) {
    return db.prepare(sql).all(...params);
  },
  /** First row (or undefined) for a SELECT. */
  get(sql, params = []) {
    return db.prepare(sql).get(...params);
  },
  /** Execute an INSERT/UPDATE/DELETE. Returns better-sqlite3 run info. */
  run(sql, params = []) {
    return db.prepare(sql).run(...params);
  },
  /** Run `fn` inside a transaction (synchronous, like better-sqlite3). */
  transaction(fn) {
    return db.transaction(fn)();
  },
  /** New UUID primary key. */
  newId() {
    return crypto.randomUUID();
  },
  /** Current timestamp — ISO-8601 UTC, lexicographically sortable (LWW key). */
  now() {
    return new Date().toISOString();
  },
  /** This installation's device identity. */
  getDeviceId() {
    return device.device_id;
  },
  getDeviceLabel() {
    return device.device_label;
  },
  /** Set the friendly label for this installation (first-run prompt). */
  setDeviceLabel(label) {
    device.device_label = String(label || '').trim() || null;
    fs.writeFileSync(devicePath, JSON.stringify(device, null, 2));
    return device.device_label;
  },
  /** Full installation config (device identity + sync settings + peer registry). */
  getDeviceConfig() {
    return { ...device };
  },
  /** Shallow-merge a patch into device.json (sync folder, peers, timestamps). */
  patchDeviceConfig(patch) {
    Object.assign(device, patch);
    fs.writeFileSync(devicePath, JSON.stringify(device, null, 2));
    return { ...device };
  },
  /** Paths, for backups/diagnostics (used by later phases). */
  paths: {
    dataDir,
    database: path.join(dataDir, 'gradebook.sqlite'),
    device: devicePath,
  },
  /** The raw better-sqlite3 handle (converter/tests only). */
  raw: db,
};

export default api;
