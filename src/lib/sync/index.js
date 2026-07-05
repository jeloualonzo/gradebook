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
  rowKey,
  rowsEqual,
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

/**
 * Own-export ring — copies of this device's recent snapshot exports, keyed by
 * the exported FILE's hash. When a peer's snapshot arrives declaring "I built
 * this having imported your file <hash>" (its `basis`), the matching entry is
 * the exact common state for three-way conflict detection.
 */
const ownExportsDir = () => path.join(db.paths.dataDir, 'own-exports');
const OWN_EXPORTS_KEEP = 8;

function writeOwnExport(fileHash, tables) {
  const dir = ownExportsDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify({ tables }), 'utf8')));
  fs.renameSync(tmp, path.join(dir, `${fileHash}.json.gz`));
  const entries = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json.gz'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const e of entries.slice(OWN_EXPORTS_KEEP)) {
    fs.rmSync(path.join(dir, e.f), { force: true });
  }
}

function readOwnExport(fileHash) {
  try {
    const raw = fs.readFileSync(path.join(ownExportsDir(), `${fileHash}.json.gz`));
    return JSON.parse(zlib.gunzipSync(raw).toString('utf8')).tables || null;
  } catch {
    return null; // unknown / pruned / first contact
  }
}

/** Export the full local state atomically into the sync folder. */
export function exportSnapshot(folder) {
  const tables = readLocalState();
  const config = db.getDeviceConfig();

  // `basis` declares which of each peer's files this state has absorbed —
  // importers use it to find the exact common state for conflict detection.
  const basis = {};
  for (const [pid, p] of Object.entries(config.peers || {})) {
    if (p?.last_imported_hash) basis[pid] = p.last_imported_hash;
  }

  // Skip the write when nothing changed since the last export: peers stay
  // genuinely "up to date" and the folder service doesn't re-upload an
  // identical file. (exported_at/device_label are excluded from the hash.)
  const exportHash = crypto.createHash('sha1').update(JSON.stringify({ tables, basis })).digest('hex');
  const finalPath = path.join(folder, fileNameFor(config.device_id));
  if (config.last_export_hash === exportHash && fs.existsSync(finalPath)) {
    return { exported_at: config.last_export_at, file: finalPath, unchanged: true };
  }

  const payload = {
    format_version: FORMAT_VERSION,
    schema_version: SCHEMA_VERSION,
    device_id: config.device_id,
    device_label: config.device_label,
    exported_at: db.now(),
    basis,
    tables,
  };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const fileHash = crypto.createHash('sha1').update(gz).digest('hex');
  const tmpPath = path.join(folder, `.tmp-${crypto.randomUUID()}`);
  fs.writeFileSync(tmpPath, gz);
  fs.renameSync(tmpPath, finalPath); // atomic: peers never see a half-written file
  writeOwnExport(fileHash, tables);
  db.patchDeviceConfig({ last_export_at: payload.exported_at, last_export_hash: exportHash });
  return { exported_at: payload.exported_at, file: finalPath, bytes: gz.length };
}

/** The upsert statement for one synced table (natural-key aware). */
function upsertStatement(table) {
  const cols = table.columns;
  const placeholders = cols.map(() => '?').join(', ');
  const nonId = cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ');
  if (!table.naturalKey) {
    return `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})
            ON CONFLICT(id) DO UPDATE SET ${nonId}`;
  }
  // Natural-key tables: an independently-created twin (same cell, different
  // UUID) conflicts on the natural key — the winner replaces it WHOLESALE,
  // id included, so both devices converge to one row. Same-row applies hit
  // either clause with identical effect.
  const all = cols.map(c => `${c} = excluded.${c}`).join(', ');
  return `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(${table.naturalKey.join(', ')}) DO UPDATE SET ${all}
          ON CONFLICT(id) DO UPDATE SET ${nonId}`;
}

const CONFLICT_LOG_KEEP = 500;

/**
 * Record real conflicts — decisions where BOTH sides changed a row since the
 * last state the editing peer acknowledged seeing from us (`basisTables` =
 * our own past export that the peer's snapshot declares as its basis).
 *
 * - Peer wins over a local row we changed since that basis → the local value
 *   was genuinely discarded here: log it (winner: 'peer').
 * - Local wins over a peer row that changed since that basis → the peer's
 *   value was genuinely discarded here: log it (winner: 'local').
 * - Everything else is ordinary propagation or staleness — never logged.
 *
 * With no basis (first contact, or the referenced export was pruned) there
 * is no reliable common state: nothing is logged rather than flooding the
 * log while a fresh laptop imports everything.
 */
function logConflicts(table, decision, localState, basisTables, peerId) {
  if (!basisTables) return 0;
  let logged = 0;
  const basisByKey = new Map((basisTables[table.name] || []).map(r => [rowKey(table, r), r]));
  const localByKey = new Map((localState[table.name] || []).map(r => [rowKey(table, r), r]));
  const add = (winnerSide, winnerRow, loserRow) => {
    db.run(
      `INSERT INTO sync_conflicts (id, table_name, row_key, row_id, peer_device_id,
        winner, winner_row, loser_row, winner_updated_at, loser_updated_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [db.newId(), table.name, rowKey(table, winnerRow), winnerRow.id, peerId,
        winnerSide, JSON.stringify(winnerRow), JSON.stringify(loserRow),
        winnerRow.updated_at || null, loserRow.updated_at || null, db.now()]
    );
    logged += 1;
  };
  for (const winner of decision.updates) {
    const loser = localByKey.get(rowKey(table, winner));
    if (!loser) continue;
    const basisRow = basisByKey.get(rowKey(table, winner));
    if (basisRow && rowsEqual(loser, basisRow, table.columns)) continue; // we hadn't changed it
    add('peer', winner, loser);
  }
  for (const { peer, local } of decision.rejects || []) {
    const basisRow = basisByKey.get(rowKey(table, peer));
    if (basisRow && rowsEqual(peer, basisRow, table.columns)) continue; // peer merely stale
    add('local', local, peer);
  }
  return logged;
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

    let raw, snapshot;
    try {
      raw = fs.readFileSync(full);
      snapshot = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
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

    // Clock sanity: a snapshot "from the future" means the peer's clock is
    // ahead — newest-wins ordering may be wrong until the clock is fixed.
    const skewMs = Date.parse(snapshot.exported_at || '') - Date.now();
    const clockSkewMinutes = Number.isFinite(skewMs) && skewMs > 5 * 60 * 1000
      ? Math.round(skewMs / 60000)
      : null;
    if (clockSkewMinutes) result.clock_skew_minutes = clockSkewMinutes;

    // Up-to-date gate by CONTENT (file hash), not by clock — a device whose
    // clock jumped backwards can still deliver new snapshots.
    const known = peers[snapshot.device_id];
    const fileHash = crypto.createHash('sha1').update(raw).digest('hex');
    if (!force && known?.last_imported_hash === fileHash) {
      result.status = 'up-to-date';
      result.exported_at = snapshot.exported_at;
      peers[snapshot.device_id] = {
        ...known,
        label: snapshot.device_label || known.label,
        last_seen_at: db.now(),
        clock_skew_minutes: clockSkewMinutes,
      };
      continue;
    }

    // One bad snapshot must never take down the whole sync run — decide and
    // apply inside a try, report per-file, and keep going.
    try {
      // Decide (pure) …
      const localState = readLocalState();
      const { decisions, totals } = mergeSnapshots(localState, snapshot.tables, {
        localDeviceId: ownId,
        peerDeviceId: snapshot.device_id,
      });

      // … then apply, parents before children, in ONE transaction. Upserts
      // only (never INSERT OR REPLACE — REPLACE would fire ON DELETE CASCADE
      // and wipe children). Rows are written exactly as the snapshot has
      // them: updated_at belongs to the original edit, not to the merge.
      // Real conflicts (both sides changed a row since the common state the
      // peer declared as its basis) are recorded in the same transaction.
      const basisTables = snapshot.basis?.[ownId] ? readOwnExport(snapshot.basis[ownId]) : null;
      let conflictsLogged = 0;
      db.transaction(() => {
        for (const table of SYNCED_TABLES) {
          const d = decisions[table.name];
          const rows = [...d.inserts, ...d.updates];
          const stmt = rows.length ? upsertStatement(table) : null;
          for (const row of rows) {
            db.run(stmt, table.columns.map(c => (row[c] === undefined ? null : row[c])));
          }
          conflictsLogged += logConflicts(table, d, localState, basisTables, snapshot.device_id);
        }
        // Bounded log: keep the newest N entries.
        db.run(
          `DELETE FROM sync_conflicts WHERE id NOT IN
             (SELECT id FROM sync_conflicts ORDER BY resolved_at DESC, id DESC LIMIT ?)`,
          [CONFLICT_LOG_KEEP]
        );
      });

      result.status = 'merged';
      result.applied = totals.applied;
      result.inserts = totals.inserts;
      result.updates = totals.updates;
      result.conflicts_logged = conflictsLogged;
      result.exported_at = snapshot.exported_at;
      peers[snapshot.device_id] = {
        label: snapshot.device_label || known?.label || null,
        last_imported_exported_at: snapshot.exported_at,
        last_imported_hash: fileHash,
        last_sync_at: db.now(),
        clock_skew_minutes: clockSkewMinutes,
      };
    } catch (err) {
      result.status = 'apply-failed';
      result.error = String(err?.message || err);
      // Do NOT advance the peer gate — the same file is retried next sync.
    }
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

/** Human-readable description of one synced row, best-effort via lookups. */
function describeRow(tableName, row) {
  const get = (sql, params) => { try { return db.get(sql, params); } catch { return null; } };
  switch (tableName) {
    case 'scores': {
      const student = get('SELECT last_name, first_name FROM students WHERE id = ?', [row.student_id]);
      const ctx = get(
        `SELECT ac.date, a.name AS assessment, s.name AS subject
           FROM assessment_columns ac
           JOIN assessments a ON a.id = ac.assessment_id
           JOIN grading_periods p ON p.id = a.period_id
           JOIN subjects s ON s.id = p.subject_id
          WHERE ac.id = ?`, [row.column_id]);
      const who = student ? `${student.last_name}, ${student.first_name}` : 'a student';
      const where = ctx ? `${ctx.assessment}${ctx.date ? ' ' + ctx.date : ''} — ${ctx.subject}` : 'an assessment';
      return { label: `Score of ${who} (${where})`, value: row.deleted_at ? 'cleared' : String(row.value) };
    }
    case 'students':
      return { label: 'Student details', value: `${row.last_name}, ${row.first_name}${row.middle_name ? ' ' + row.middle_name : ''}${row.deleted_at ? ' (deleted)' : ''}` };
    case 'subjects':
      return { label: `Subject settings — ${row.name}`, value: `${row.name} · ${row.section} · weights ${row.prelim_weight}/${row.midterm_weight}/${row.final_weight}${row.deleted_at ? ' (deleted)' : ''}` };
    case 'assessments':
      return { label: 'Assessment', value: `${row.name}${row.weight_percent ? ` (${row.weight_percent}%)` : ''}${row.deleted_at ? ' (deleted)' : ''}` };
    case 'assessment_columns':
      return { label: 'Assessment column', value: `${row.date || 'no date'} · max ${row.max_score}${row.deleted_at ? ' (deleted)' : ''}` };
    default:
      return { label: tableName.replace(/_/g, ' '), value: row.deleted_at ? 'deleted' : 'edited' };
  }
}

/** The most recent resolved conflicts, readable enough for the Sync dialog. */
export function recentConflicts(limit = 20) {
  const config = db.getDeviceConfig();
  const peerLabel = (id) => config.peers?.[id]?.label || 'the other laptop';
  const rows = db.all(
    'SELECT * FROM sync_conflicts ORDER BY resolved_at DESC, id DESC LIMIT ?',
    [Math.max(1, Math.min(100, limit))]
  );
  const ownLabel = config.device_label || 'this laptop';
  return rows.map(r => {
    let winnerRow = {}, loserRow = {};
    try { winnerRow = JSON.parse(r.winner_row); } catch { /* keep {} */ }
    try { loserRow = JSON.parse(r.loser_row); } catch { /* keep {} */ }
    const kept = describeRow(r.table_name, winnerRow);
    const discarded = describeRow(r.table_name, loserRow);
    return {
      id: r.id,
      resolved_at: r.resolved_at,
      label: kept.label,
      kept: kept.value,
      kept_from: r.winner === 'peer' ? peerLabel(r.peer_device_id) : ownLabel,
      kept_at: r.winner_updated_at,
      discarded: discarded.value,
      discarded_from: r.winner === 'peer' ? ownLabel : peerLabel(r.peer_device_id),
      discarded_at: r.loser_updated_at,
    };
  });
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
