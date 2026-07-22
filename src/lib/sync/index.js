import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import db from '@/lib/db';
import { displayName } from '@/lib/names';
import { formatNumber } from '@/lib/gradeCalculator';
import {
  SYNCED_TABLES,
  FORMAT_VERSION,
  SCHEMA_VERSION,
  mergeSnapshots,
  snapshotProblem,
  rowKey,
  rowsEqual,
} from './engine.mjs';
import { semanticallyEqual } from './review.mjs';

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
 * SEMANTIC conflicts only (see review.mjs): an entry is written only when
 * the two versions differ in data a teacher could actually SEE. Rows that
 * differ merely in bookkeeping — updated_at from a no-op re-save, ids from
 * identical independently-created twins, deletion timestamps of the same
 * outcome — converge silently; there is no decision for a human to make.
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
    if (semanticallyEqual(table, winner, loser)) continue; // same gradebook data — nothing to review
    const basisRow = basisByKey.get(rowKey(table, winner));
    if (basisRow && rowsEqual(loser, basisRow, table.columns)) continue; // we hadn't changed it
    add('peer', winner, loser);
  }
  for (const { peer, local } of decision.rejects || []) {
    if (semanticallyEqual(table, local, peer)) continue; // same gradebook data — nothing to review
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
  // The staleness sentinel's anchor: when a full run last COMPLETED. This is
  // deliberately different from last_export_at (which only moves when content
  // changed) — a healthy sync of an unchanged database still counts as fresh.
  db.patchDeviceConfig({ last_sync_run_at: db.now() });
  return { ok: true, exported, imported, synced_at: db.now() };
}

/**
 * Human-readable description of one synced row, best-effort via lookups —
 * every label carries enough context (subject, period, assessment) that a
 * conflict entry is recognizable days later without opening details.
 */
function describeRow(tableName, row) {
  const get = (sql, params) => { try { return db.get(sql, params); } catch { return null; } };
  const periodSubject = (periodId) => get(
    `SELECT p.type AS period, s.name AS subject FROM grading_periods p JOIN subjects s ON s.id = p.subject_id WHERE p.id = ?`,
    [periodId]
  );
  switch (tableName) {
    case 'scores': {
      const student = get('SELECT last_name, first_name FROM students WHERE id = ?', [row.student_id]);
      const ctx = get(
        `SELECT ac.date, a.name AS assessment, a.is_exam, p.type AS period, s.name AS subject
           FROM assessment_columns ac
           JOIN assessments a ON a.id = ac.assessment_id
           JOIN grading_periods p ON p.id = a.period_id
           JOIN subjects s ON s.id = p.subject_id
          WHERE ac.id = ?`, [row.column_id]);
      const who = student ? `${student.last_name}, ${student.first_name}` : 'a student';
      const where = ctx
        ? `${ctx.is_exam ? 'Exam' : ctx.assessment}${ctx.date ? ' ' + ctx.date : ''} · ${ctx.period} — ${ctx.subject}`
        : 'an assessment';
      return { label: `Score of ${who} (${where})`, value: row.deleted_at || row.value === null || row.value === undefined ? 'cleared' : String(formatNumber(row.value)) };
    }
    case 'students': {
      const subj = get('SELECT name FROM subjects WHERE id = ?', [row.subject_id]);
      return {
        label: `Student — ${subj ? subj.name : 'a subject'}`,
        value: `${row.last_name}, ${row.first_name}${row.middle_name ? ' ' + row.middle_name : ''}${row.suffix ? ' ' + row.suffix : ''}${row.deleted_at ? ' (deleted)' : ''}`,
      };
    }
    case 'subjects':
      return { label: `Subject settings — ${row.name}`, value: `${row.name} · ${row.section} · weights ${formatNumber(row.prelim_weight)}/${formatNumber(row.midterm_weight)}/${formatNumber(row.final_weight)}${row.deleted_at ? ' (deleted)' : ''}` };
    case 'assessments': {
      const ctx = periodSubject(row.period_id);
      return {
        label: `Assessment${ctx ? ` (${ctx.period} — ${ctx.subject})` : ''}`,
        value: `${row.name}${row.weight_percent ? ` (${formatNumber(row.weight_percent)}%)` : ''}${row.deleted_at ? ' (deleted)' : ''}`,
      };
    }
    case 'assessment_columns': {
      const ctx = get(
        `SELECT a.name AS assessment, a.is_exam, p.type AS period, s.name AS subject
           FROM assessments a JOIN grading_periods p ON p.id = a.period_id JOIN subjects s ON s.id = p.subject_id
          WHERE a.id = ?`, [row.assessment_id]);
      return {
        label: ctx ? `${ctx.is_exam ? 'Exam' : ctx.assessment} date column (${ctx.period} — ${ctx.subject})` : 'Assessment column',
        value: `${row.date || 'no date'} · max ${formatNumber(row.max_score)}${row.attendance_source ? ' · counts as attendance' : ''}${row.deleted_at ? ' (deleted)' : ''}`,
      };
    }
    case 'attendance_config': {
      const ctx = periodSubject(row.period_id);
      return {
        label: `Attendance scoring${ctx ? ` (${ctx.period} — ${ctx.subject})` : ''}`,
        value: `Present ${formatNumber(row.present_score)} · Late ${formatNumber(row.late_score)} · Absent ${formatNumber(row.absent_score)}`,
      };
    }
    case 'grading_periods': {
      const subj = get('SELECT name FROM subjects WHERE id = ?', [row.subject_id]);
      return { label: `Grading period — ${subj ? subj.name : 'a subject'}`, value: `${row.type}${row.deleted_at ? ' (deleted)' : ''}` };
    }
    case 'student_groups':
      return { label: 'Student group', value: `${row.name}${row.deleted_at ? ' (deleted)' : ''}` };
    case 'notes': {
      const target = describeNoteTarget(row);
      const body = String(row.body || '');
      return {
        label: `Note — ${target}`,
        value: row.deleted_at ? 'deleted' : (body.length > 80 ? body.slice(0, 77) + '…' : body),
      };
    }
    case 'group_students': {
      const grp = get('SELECT name FROM student_groups WHERE id = ?', [row.group_id]);
      return {
        label: `Group member — ${grp ? grp.name : 'a group'}`,
        value: `${row.last_name}, ${row.first_name}${row.middle_name ? ' ' + row.middle_name : ''}${row.suffix ? ' ' + row.suffix : ''}${row.deleted_at ? ' (deleted)' : ''}`,
      };
    }
    default:
      return { label: tableName.replace(/_/g, ' '), value: row.deleted_at ? 'deleted' : 'edited' };
  }
}

/**
 * What a note is ATTACHED TO, in gradebook language — shared by the conflict
 * list label and the details context ("Quiz · July 8 — IT101" beats a UUID).
 */
function describeNoteTarget(row) {
  const get = (sql, params) => { try { return db.get(sql, params); } catch { return null; } };
  const columnPlace = (columnId) => {
    const m = get(
      `SELECT ac.date, a.name AS assessment, a.is_exam, p.type AS period, s.name AS subject
         FROM assessment_columns ac
         JOIN assessments a ON a.id = ac.assessment_id
         JOIN grading_periods p ON p.id = a.period_id
         JOIN subjects s ON s.id = p.subject_id
        WHERE ac.id = ?`, [columnId]);
    return m
      ? `${m.is_exam ? 'Exam' : m.assessment}${m.date ? ' · ' + longDate(m.date) : ''} (${m.period} — ${m.subject})`
      : 'an assessment column';
  };
  switch (row.entity_type) {
    case 'column':
      return columnPlace(row.entity_id);
    case 'cell': {
      const [columnId, studentId] = String(row.entity_id || '').split(':');
      const student = get('SELECT last_name, first_name FROM students WHERE id = ?', [studentId]);
      const who = student ? `${student.last_name}, ${student.first_name}` : 'a student';
      return `${who} — ${columnPlace(columnId)}`;
    }
    case 'student': {
      const student = get('SELECT last_name, first_name FROM students WHERE id = ?', [row.entity_id]);
      return student ? `${student.last_name}, ${student.first_name}` : 'a student';
    }
    case 'subject': {
      const subj = get('SELECT name FROM subjects WHERE id = ?', [row.entity_id]);
      return subj ? subj.name : 'a subject';
    }
    default:
      return 'an item';
  }
}

/** Shared winner/loser attribution shape for the list and the details view. */
function conflictAttribution(r, config, winnerRow, loserRow) {
  const peerLabel = (id) => config.peers?.[id]?.label || 'the other laptop';
  const ownLabel = config.device_label || 'this laptop';
  const kept = describeRow(r.table_name, winnerRow);
  const discarded = describeRow(r.table_name, loserRow);
  return {
    label: kept.label,
    kept: kept.value,
    kept_from: r.winner === 'peer' ? peerLabel(r.peer_device_id) : ownLabel,
    kept_at: r.winner_updated_at,
    discarded: discarded.value,
    discarded_from: r.winner === 'peer' ? ownLabel : peerLabel(r.peer_device_id),
    discarded_at: r.loser_updated_at,
  };
}

/** The subject a conflict belongs to (best-effort, for contextual banners). */
function conflictSubjectId(tableName, row) {
  const get = (sql, params) => { try { return db.get(sql, params); } catch { return null; } };
  switch (tableName) {
    case 'subjects':
      return row.id || null;
    case 'grading_periods':
    case 'students':
      return row.subject_id || null;
    case 'assessments':
      return get('SELECT subject_id FROM grading_periods WHERE id = ?', [row.period_id])?.subject_id || null;
    case 'attendance_config':
      return get('SELECT subject_id FROM grading_periods WHERE id = ?', [row.period_id])?.subject_id || null;
    case 'assessment_columns':
      return get(
        `SELECT p.subject_id FROM assessments a JOIN grading_periods p ON p.id = a.period_id WHERE a.id = ?`,
        [row.assessment_id]
      )?.subject_id || null;
    case 'scores':
      return get(
        `SELECT p.subject_id
           FROM assessment_columns ac
           JOIN assessments a ON a.id = ac.assessment_id
           JOIN grading_periods p ON p.id = a.period_id
          WHERE ac.id = ?`,
        [row.column_id]
      )?.subject_id || null;
    case 'notes':
      return row.subject_id || null; // denormalized at write time
    default:
      return null; // student groups etc. — not subject-scoped
  }
}

/** The row a conflict decided, as it exists in the database NOW (or null). */
function locateCurrentRow(table, winnerRow) {
  try {
    if (table.naturalKey) {
      return db.get(
        `SELECT * FROM ${table.name} WHERE ${table.naturalKey.map(c => `${c} = ?`).join(' AND ')}`,
        table.naturalKey.map(c => winnerRow[c])
      ) || null;
    }
    return db.get(`SELECT * FROM ${table.name} WHERE id = ?`, [winnerRow.id]) || null;
  } catch {
    return null;
  }
}

/**
 * Resolved conflicts with everything the review UI needs: readable labels,
 * both values with laptop attribution, the owning subject (for contextual
 * banners), review state, and whether Restore is still possible.
 */
export function listConflicts(limit = 100) {
  const config = db.getDeviceConfig();
  const rows = db.all(
    'SELECT * FROM sync_conflicts ORDER BY resolved_at DESC, id DESC LIMIT ?',
    [Math.max(1, Math.min(200, limit))]
  );
  return rows.map(r => {
    let winnerRow = {}, loserRow = {};
    try { winnerRow = JSON.parse(r.winner_row); } catch { /* keep {} */ }
    try { loserRow = JSON.parse(r.loser_row); } catch { /* keep {} */ }
    const table = SYNCED_TABLES.find(t => t.name === r.table_name) || null;
    return {
      id: r.id,
      table_name: r.table_name,
      resolved_at: r.resolved_at,
      reviewed_at: r.reviewed_at || null,
      subject_id: conflictSubjectId(r.table_name, winnerRow) || conflictSubjectId(r.table_name, loserRow),
      ...conflictAttribution(r, config, winnerRow, loserRow),
      restorable: !!(table && locateCurrentRow(table, winnerRow)),
    };
  });
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 'YYYY-MM-DD' → 'July 8, 2026' (parsed manually — no timezone surprises). */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return iso ? String(iso) : 'no date';
  return `${MONTH_NAMES[+m[2] - 1]} ${+m[3]}, ${+m[1]}`;
}

/**
 * Everything the details view needs to judge a conflict in GRADEBOOK
 * language: context rows (subject, period, assessment, date, student …)
 * plus an entity-appropriate comparison —
 *   scores            → a miniature gradebook (neighboring students, the
 *                       conflicted cell flagged; Previous vs Current)
 *   everything else   → a field-by-field Previous/Current table
 * "Current" always reflects the database NOW; `superseded` says the row
 * has been edited again since the merge decided this conflict.
 */
export function conflictDetails(conflictId) {
  const r = db.get('SELECT * FROM sync_conflicts WHERE id = ?', [conflictId]);
  if (!r) return null;
  const config = db.getDeviceConfig();
  const table = SYNCED_TABLES.find(t => t.name === r.table_name) || null;
  let winnerRow = {}, loserRow = {};
  try { winnerRow = JSON.parse(r.winner_row); } catch { /* keep {} */ }
  try { loserRow = JSON.parse(r.loser_row); } catch { /* keep {} */ }
  const current = table ? locateCurrentRow(table, winnerRow) : null;
  const get = (sql, params) => { try { return db.get(sql, params); } catch { return null; } };

  const context = [];
  const push = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') context.push({ label, value: String(value) });
  };
  const yn = (v) => (v ? 'Yes' : 'No');
  // sort_order is 0-based internally; teachers count from 1.
  const pos = (v) => (v === null || v === undefined ? v : Number(v) + 1);
  const codeName = (m) => m && `${m.subject_code ? m.subject_code + ' — ' : ''}${m.subject || m.name}`;

  // Field-by-field comparison. Previous = the discarded version; Current =
  // the row as it stands NOW (kept version if the row vanished).
  const fieldComparison = (defs) => {
    const after = current || winnerRow;
    const str = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
    const fields = defs.map(([key, label, fmt]) => {
      const f = fmt || ((v) => v);
      const before = str(f(loserRow[key]));
      const now = str(f(after[key]));
      return { key, label, before, after: now, changed: before !== now };
    });
    fields.push({
      key: 'status',
      label: 'Status',
      before: loserRow.deleted_at ? 'Deleted' : 'Active',
      after: after.deleted_at ? 'Deleted' : 'Active',
      changed: !!loserRow.deleted_at !== !!after.deleted_at,
    });
    return {
      type: 'fields',
      fields,
      superseded: !!(current && table && !rowsEqual(current, winnerRow, table.columns.filter(c => c !== 'updated_at'))),
    };
  };

  let comparison = null;
  switch (r.table_name) {
    case 'scores': {
      const meta = get(
        `SELECT ac.date, ac.max_score, ac.attendance_source, a.name AS assessment, a.is_exam,
                p.type AS period, s.id AS subject_id, s.name AS subject, s.subject_code, s.section, s.school_year
           FROM assessment_columns ac
           JOIN assessments a ON a.id = ac.assessment_id
           JOIN grading_periods p ON p.id = a.period_id
           JOIN subjects s ON s.id = p.subject_id
          WHERE ac.id = ?`, [winnerRow.column_id]);
      const student = get('SELECT * FROM students WHERE id = ?', [winnerRow.student_id]);
      push('Subject', codeName(meta));
      push('Section', meta?.section);
      push('School Year', meta?.school_year);
      push('Grading Period', meta?.period);
      push('Assessment', meta && (meta.is_exam ? 'Exam' : meta.assessment));
      push('Date', meta && longDate(meta.date));
      push('Max Score', meta && formatNumber(meta.max_score));
      push('Counts as Attendance', meta && yn(meta.attendance_source));
      push('Student', student && displayName(student));

      const scoreVal = (row) => (!row || row.deleted_at || row.value === null || row.value === undefined ? '—' : String(formatNumber(row.value)));
      if (meta && student) {
        // Miniature gradebook: the student plus up to two roster neighbors on
        // each side, in the exact order the real grid uses. Neighbor values
        // are the LIVE ones — pure recognition context.
        const roster = db.all(
          `SELECT * FROM students WHERE subject_id = ? AND deleted_at IS NULL
            ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, middle_name COLLATE NOCASE`,
          [meta.subject_id]
        );
        const idx = roster.findIndex(s => s.id === student.id);
        const windowRows = idx === -1 ? [student] : roster.slice(Math.max(0, idx - 2), idx + 3);
        const live = new Map(
          db.all('SELECT student_id, value, deleted_at FROM scores WHERE column_id = ?', [winnerRow.column_id]).map(x => [x.student_id, x])
        );
        comparison = {
          type: 'score-grid',
          header: `${meta.is_exam ? 'Exam' : meta.assessment}${meta.date ? ' · ' + longDate(meta.date) : ''} · max ${formatNumber(meta.max_score)}`,
          students: windowRows.map(s => {
            const conflicted = s.id === student.id;
            const now = scoreVal(live.get(s.id));
            return { name: displayName(s), conflicted, before: conflicted ? scoreVal(loserRow) : now, after: now };
          }),
          superseded: scoreVal(live.get(student.id)) !== scoreVal(winnerRow),
        };
      } else {
        comparison = {
          type: 'fields',
          fields: [{ key: 'value', label: 'Score', before: scoreVal(loserRow), after: scoreVal(current || winnerRow), changed: scoreVal(loserRow) !== scoreVal(current || winnerRow) }],
          superseded: false,
        };
      }
      break;
    }
    case 'assessment_columns': {
      const meta = get(
        `SELECT a.name AS assessment, a.is_exam, p.type AS period, s.name AS subject, s.subject_code, s.section, s.school_year
           FROM assessments a JOIN grading_periods p ON p.id = a.period_id JOIN subjects s ON s.id = p.subject_id
          WHERE a.id = ?`, [winnerRow.assessment_id]);
      push('Subject', codeName(meta));
      push('Section', meta?.section);
      push('School Year', meta?.school_year);
      push('Grading Period', meta?.period);
      push('Assessment', meta && (meta.is_exam ? 'Exam' : meta.assessment));
      comparison = fieldComparison([
        ['date', 'Date', longDate],
        ['max_score', 'Max Score', formatNumber],
        ['attendance_source', 'Counts as Attendance', yn],
        ['sort_order', 'Position', pos],
      ]);
      // Moved columns: the two versions can live under DIFFERENT assessments
      // (move-column-to-subject). A bare UUID explains nothing — resolve both
      // sides to names, and only when they actually differ (the context above
      // already names the current assessment in the ordinary case).
      const afterRow = current || winnerRow;
      if (String(loserRow.assessment_id || '') !== String(afterRow.assessment_id || '')) {
        const place = (assessmentId) => {
          const m = get(
            `SELECT a.name, a.is_exam, p.type AS period, s.name AS subject
               FROM assessments a JOIN grading_periods p ON p.id = a.period_id JOIN subjects s ON s.id = p.subject_id
              WHERE a.id = ?`, [assessmentId]);
          return m ? `${m.is_exam ? 'Exam' : m.name} (${m.period} — ${m.subject})` : 'an unknown assessment';
        };
        comparison.fields.unshift({
          key: 'assessment_id',
          label: 'Assessment',
          before: place(loserRow.assessment_id),
          after: place(afterRow.assessment_id),
          changed: true,
        });
      }
      break;
    }
    case 'assessments': {
      const meta = get(
        `SELECT p.type AS period, s.name AS subject, s.subject_code, s.section
           FROM grading_periods p JOIN subjects s ON s.id = p.subject_id WHERE p.id = ?`, [winnerRow.period_id]);
      push('Subject', codeName(meta));
      push('Section', meta?.section);
      push('Grading Period', meta?.period);
      comparison = fieldComparison([
        ['name', 'Assessment Name'],
        ['weight_percent', 'Weight %', formatNumber],
        ['sort_order', 'Position', pos],
      ]);
      break;
    }
    case 'students': {
      const meta = get('SELECT name AS subject, subject_code, section FROM subjects WHERE id = ?', [winnerRow.subject_id]);
      push('Subject', codeName(meta));
      push('Section', meta?.section);
      comparison = fieldComparison([
        ['last_name', 'Last Name'],
        ['first_name', 'First Name'],
        ['middle_name', 'Middle Name'],
        ['suffix', 'Suffix'],
      ]);
      break;
    }
    case 'group_students': {
      const meta = get('SELECT name FROM student_groups WHERE id = ?', [winnerRow.group_id]);
      push('Student Group', meta?.name);
      comparison = fieldComparison([
        ['last_name', 'Last Name'],
        ['first_name', 'First Name'],
        ['middle_name', 'Middle Name'],
        ['suffix', 'Suffix'],
        ['sort_order', 'Position', pos], // group members render by drag order
      ]);
      break;
    }
    case 'student_groups':
      comparison = fieldComparison([
        ['name', 'Group Name'],
        ['description', 'Description'],
      ]);
      break;
    case 'notes':
      push('Note on', describeNoteTarget(winnerRow));
      comparison = fieldComparison([['body', 'Note']]);
      break;
    case 'subjects':
      comparison = fieldComparison([
        ['name', 'Subject Title'],
        ['subject_code', 'Subject Code'],
        ['section', 'Section'],
        ['semester', 'Semester'],
        ['school_year', 'School Year'],
        ['prelim_weight', 'Prelim Weight %', formatNumber],
        ['midterm_weight', 'Midterm Weight %', formatNumber],
        ['final_weight', 'Final Weight %', formatNumber],
      ]);
      break;
    case 'attendance_config': {
      const meta = get(
        `SELECT p.type AS period, s.name AS subject FROM grading_periods p JOIN subjects s ON s.id = p.subject_id WHERE p.id = ?`,
        [winnerRow.period_id]);
      push('Subject', meta?.subject);
      push('Grading Period', meta?.period);
      comparison = fieldComparison([
        ['present_score', 'Present Score', formatNumber],
        ['late_score', 'Late Score', formatNumber],
        ['absent_score', 'Absent Score', formatNumber],
      ]);
      break;
    }
    case 'grading_periods': {
      const subj = get('SELECT name FROM subjects WHERE id = ?', [winnerRow.subject_id]);
      push('Subject', subj?.name);
      comparison = fieldComparison([['type', 'Period']]);
      break;
    }
    default:
      comparison = null;
  }

  return {
    id: r.id,
    table_name: r.table_name,
    resolved_at: r.resolved_at,
    reviewed_at: r.reviewed_at || null,
    restorable: !!(table && current),
    ...conflictAttribution(r, config, winnerRow, loserRow),
    context,
    comparison,
  };
}

/** Number of conflicts awaiting review (drives the badge + toast). */
export function unreviewedConflictCount() {
  return db.get('SELECT COUNT(*) AS n FROM sync_conflicts WHERE reviewed_at IS NULL')?.n || 0;
}

/** Mark conflicts as reviewed. Pass { all: true } or { ids: [...] }. */
export function markConflictsReviewed({ ids = null, all = false } = {}) {
  const now = db.now();
  if (all) {
    return db.run('UPDATE sync_conflicts SET reviewed_at = ? WHERE reviewed_at IS NULL', [now]).changes;
  }
  let changed = 0;
  for (const id of ids || []) {
    changed += db.run('UPDATE sync_conflicts SET reviewed_at = ? WHERE id = ? AND reviewed_at IS NULL', [now, id]).changes;
  }
  return changed;
}

/**
 * Restore the LOSING version of a conflict — as an ORDINARY NEW EDIT.
 *
 * The current row simply gets the discarded values back with a fresh
 * updated_at from this device, so the restore propagates through normal
 * sync and wins everywhere (an informed sequential edit — it will not log
 * a new conflict on the other laptop). The merge engine is untouched.
 * The value it replaces stays visible in this conflict entry (winner_row).
 */
export function restoreConflictLoser(conflictId) {
  const r = db.get('SELECT * FROM sync_conflicts WHERE id = ?', [conflictId]);
  if (!r) throw new Error('Conflict entry not found.');
  const table = SYNCED_TABLES.find(t => t.name === r.table_name);
  if (!table) throw new Error(`Unknown table: ${r.table_name}`);
  const winnerRow = JSON.parse(r.winner_row);
  const loserRow = JSON.parse(r.loser_row);
  const current = locateCurrentRow(table, winnerRow);
  if (!current) throw new Error('That row no longer exists on this laptop.');

  // Everything except identity/lineage gets the discarded values back.
  const dataCols = table.columns.filter(c => !['id', 'created_at', 'updated_at'].includes(c));
  db.transaction(() => {
    db.run(
      `UPDATE ${table.name} SET ${dataCols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...dataCols.map(c => (loserRow[c] === undefined ? null : loserRow[c])), db.now(), current.id]
    );
    db.run('UPDATE sync_conflicts SET reviewed_at = ? WHERE id = ?', [db.now(), conflictId]);
  });
  const restored = describeRow(r.table_name, loserRow);
  return { label: restored.label, restored: restored.value };
}

// Silence longer than this with a folder configured means sync is failing
// QUIETLY (cloud drive signed out, folder renamed…) — the one remaining way
// two laptops could diverge for days without anyone noticing. Surfaced as
// `stale` below and shown amber in the UI.
const SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function syncStatus() {
  const config = db.getDeviceConfig();
  const folder = config.sync_folder || null;
  const lastRun = config.last_sync_run_at || null;
  const runAge = lastRun ? Date.now() - Date.parse(lastRun) : Infinity;
  return {
    device_id: config.device_id,
    device_label: config.device_label,
    sync_folder: folder,
    folder_problem: folder ? validateSyncFolder(folder) : null,
    last_export_at: config.last_export_at || null,
    last_sync_run_at: lastRun,
    stale: !!folder && !(runAge < SYNC_STALE_AFTER_MS),
    unreviewed_conflicts: unreviewedConflictCount(),
    peers: Object.entries(config.peers || {}).map(([device_id, p]) => ({ device_id, ...p })),
  };
}
