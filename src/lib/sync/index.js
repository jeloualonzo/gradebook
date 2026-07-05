import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import db from '@/lib/db';
import {
  SYNCED_TABLES,
  FORMAT_VERSION,
  SCHEMA_VERSION,
  mergeSnapshots,
  snapshotProblem,
} from './engine.mjs';

/**
 * Snapshot transport over a shared folder (Google Drive / Dropbox / Syncthing
 * / USB stick — anything that moves files). Each device writes ONE file:
 *
 *   <folder>/gradebook-<device_id>.json.gz
 *
 * and merges every other device's file. All decisions come from the pure
 * engine (src/lib/sync/engine.mjs); this module only does I/O.
 */

const fileNameFor = (deviceId) => `gradebook-${deviceId}.json.gz`;
const FILE_RE = /^gradebook-([0-9a-f-]{36})\.json\.gz$/;

/** Read the COMPLETE local state (including tombstoned rows). */
function readLocalState() {
  const state = {};
  for (const table of SYNCED_TABLES) {
    state[table.name] = db.all(`SELECT ${table.columns.join(', ')} FROM ${table.name}`);
  }
  return state;
}

/**
 * Guard against the classic SQLite-in-Dropbox corruption trap: the sync
 * folder must never be the data directory (or contain it, or live inside it).
 */
export function validateSyncFolder(folder) {
  if (!folder || !String(folder).trim()) return 'A folder path is required.';
  const abs = path.resolve(String(folder).trim());
  if (!fs.existsSync(abs)) return 'That folder does not exist.';
  if (!fs.statSync(abs).isDirectory()) return 'That path is not a folder.';
  const dataDir = path.resolve(db.paths.dataDir);
  if (abs === dataDir || abs.startsWith(dataDir + path.sep) || dataDir.startsWith(abs + path.sep)) {
    return 'The sync folder must be separate from the app data folder (never place the live database in a synced folder).';
  }
  try {
    const probe = path.join(abs, `.gradebook-write-test-${crypto.randomUUID()}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
  } catch {
    return 'That folder is not writable.';
  }
  return null;
}

/** Export the full local state atomically into the sync folder. */
export function exportSnapshot(folder) {
  const tables = readLocalState();

  // Skip the write when nothing changed since the last export: peers stay
  // genuinely "up to date" and the folder service doesn't re-upload an
  // identical file. (exported_at/device_label are excluded from the hash.)
  const config = db.getDeviceConfig();
  const hash = crypto.createHash('sha1').update(JSON.stringify(tables)).digest('hex');
  const finalPath = path.join(folder, fileNameFor(config.device_id));
  if (config.last_export_hash === hash && fs.existsSync(finalPath)) {
    return { exported_at: config.last_export_at, file: finalPath, unchanged: true };
  }

  const payload = {
    format_version: FORMAT_VERSION,
    schema_version: SCHEMA_VERSION,
    device_id: config.device_id,
    device_label: config.device_label,
    exported_at: db.now(),
    tables,
  };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const tmpPath = path.join(folder, `.tmp-${crypto.randomUUID()}`);
  fs.writeFileSync(tmpPath, gz);
  fs.renameSync(tmpPath, finalPath); // atomic: peers never see a half-written file
  db.patchDeviceConfig({ last_export_at: payload.exported_at, last_export_hash: hash });
  return { exported_at: payload.exported_at, file: finalPath, bytes: gz.length };
}

/** Merge every peer snapshot found in the folder. */
export function importPeerSnapshots(folder, { force = false } = {}) {
  const ownId = db.getDeviceId();
  const config = db.getDeviceConfig();
  const peers = { ...(config.peers || {}) };
  const results = [];

  const entries = fs.readdirSync(folder).filter(f => {
    const m = f.match(FILE_RE);
    return m && m[1] !== ownId;
  });

  for (const file of entries) {
    const full = path.join(folder, file);
    const result = { file, device_id: null, label: null, status: 'error', applied: 0 };
    results.push(result);

    let snapshot;
    try {
      snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(full)).toString('utf8'));
    } catch {
      result.status = 'corrupt-file-skipped';
      continue;
    }

    const problem = snapshotProblem(snapshot, ownId);
    result.device_id = snapshot?.device_id || null;
    result.label = snapshot?.device_label || null;
    if (problem) {
      result.status = problem;
      continue;
    }

    const known = peers[snapshot.device_id];
    if (!force && known?.last_imported_exported_at && snapshot.exported_at <= known.last_imported_exported_at) {
      result.status = 'up-to-date';
      result.exported_at = snapshot.exported_at;
      peers[snapshot.device_id] = { ...known, label: snapshot.device_label || known.label, last_seen_at: db.now() };
      continue;
    }

    // Decide (pure) …
    const localState = readLocalState();
    const { decisions, totals } = mergeSnapshots(localState, snapshot.tables, {
      localDeviceId: ownId,
      peerDeviceId: snapshot.device_id,
    });

    // … then apply, parents before children, in ONE transaction. Upserts only
    // (never INSERT OR REPLACE — REPLACE would fire ON DELETE CASCADE and wipe
    // children). Rows are written exactly as the snapshot has them: updated_at
    // belongs to the original edit, not to the merge.
    db.transaction(() => {
      for (const table of SYNCED_TABLES) {
        const d = decisions[table.name];
        const rows = [...d.inserts, ...d.updates];
        if (rows.length === 0) continue;
        const cols = table.columns;
        const placeholders = cols.map(() => '?').join(', ');
        const updateSet = cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ');
        const stmt = `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})
                      ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
        for (const row of rows) {
          db.run(stmt, cols.map(c => (row[c] === undefined ? null : row[c])));
        }
      }
    });

    result.status = 'merged';
    result.applied = totals.applied;
    result.inserts = totals.inserts;
    result.updates = totals.updates;
    result.exported_at = snapshot.exported_at;
    peers[snapshot.device_id] = {
      label: snapshot.device_label || known?.label || null,
      last_imported_exported_at: snapshot.exported_at,
      last_sync_at: db.now(),
    };
  }

  db.patchDeviceConfig({ peers });
  return results;
}

/** Export + import in one pass. The whole thing is idempotent and safe to re-run. */
export function runSync({ force = false } = {}) {
  const config = db.getDeviceConfig();
  const folder = config.sync_folder;
  const folderProblem = validateSyncFolder(folder);
  if (folderProblem) {
    return { ok: false, error: folderProblem };
  }
  const imported = importPeerSnapshots(folder, { force });
  const exported = exportSnapshot(folder); // export AFTER import so the file reflects the merged state
  return { ok: true, exported, imported, synced_at: db.now() };
}

export function syncStatus() {
  const config = db.getDeviceConfig();
  const folder = config.sync_folder || null;
  return {
    device_id: config.device_id,
    device_label: config.device_label,
    sync_folder: folder,
    folder_problem: folder ? validateSyncFolder(folder) : null,
    last_export_at: config.last_export_at || null,
    peers: Object.entries(config.peers || {}).map(([device_id, p]) => ({ device_id, ...p })),
  };
}
