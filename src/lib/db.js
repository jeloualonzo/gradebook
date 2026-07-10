import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runMigrations } from './migrations';
import { SCHEMA_SQL } from './schema.mjs';
import { toCents } from './gradeCalculator';

/**
 * SQLite storage engine — zero configuration by design.
 *
 * - The database is a single file in the data directory (default: ./data,
 *   overridable with GRADEBOOK_DATA_DIR — the Electron shell points this at
 *   the OS app-data folder).
 * - The schema is statically imported (src/lib/schema.mjs) and bootstraps
 *   itself on first open (CREATE TABLE IF NOT EXISTS) — nothing to install,
 *   configure, or migrate by hand. IMPORTANT: never load the schema (or any
 *   file) via a runtime-computed path here — dynamic fs reads in server code
 *   make Next's output tracing glob the whole project into the desktop
 *   bundle (see src/lib/schema.mjs for the full story).
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

// Bootstrap the schema (statically imported — no file read at runtime).
db.exec(SCHEMA_SQL);
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
  /**
   * True when a submitted value and a stored value are the same DATA.
   * Conservative on purpose: only clearly-equal pairs skip a write — any
   * doubt writes exactly as before the guard existed. Numeric pairs compare
   * through integer cents (toCents), per the house rule: never raw float
   * comparison on scores/weights.
   */
  valuesEqual(a, b) {
    const an = a === undefined ? null : a;
    const bn = b === undefined ? null : b;
    if (an === null || bn === null) return an === bn;
    if (an === bn) return true;
    const numeric = (v) =>
      typeof v === 'number' ? isFinite(v)
        : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v));
    if (numeric(an) && numeric(bn)) return toCents(an) === toCents(bn);
    return false;
  },
  /**
   * Guarded UPDATE-by-id — THE way to write user edits to an existing row.
   *
   * Compares the submitted fields against the current row and:
   *   · writes NOTHING when no value actually changes. A save that changes
   *     no data must not touch updated_at: a fresh stamp on unchanged
   *     content re-enters last-write-wins and can beat a REAL edit from the
   *     other laptop, and it used to flood the conflict review with
   *     identical-content entries (the attendance-page re-save bug);
   *   · otherwise updates only the changed fields, stamping updated_at once.
   *
   * Domain normalization (trimming, `flag ? 1 : 0`, '' defaults) stays in
   * each query function — per-table semantics belong there; this helper owns
   * the comparison and stamping policy so every endpoint gets the guard for
   * free. Missing rows write nothing, exactly like the unguarded
   * `UPDATE … WHERE id = ?` this replaces.
   *
   * NOT for restoreConflictLoser: a conflict restore deliberately re-stamps
   * unchanged-looking data so it wins everywhere — that exception is
   * documented there and must stay on a raw UPDATE.
   */
  updateRow(tableName, id, fields) {
    const current = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
    if (!current) return { changed: false };
    const cols = Object.keys(fields).filter(c => !api.valuesEqual(fields[c], current[c]));
    if (cols.length === 0) return { changed: false };
    db.prepare(
      `UPDATE ${tableName} SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
    ).run(...cols.map(c => (fields[c] === undefined ? null : fields[c])), api.now(), id);
    return { changed: true };
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
