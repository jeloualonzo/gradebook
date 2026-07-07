/**
 * Sync merge engine — PURE functions only. No database, no filesystem, no
 * network. Everything here is deterministic and unit-testable with plain
 * fixtures (see scripts/test-sync-engine.mjs).
 *
 * Model (per the agreed spec):
 * - Each device exports its FULL state (every row of every synced table,
 *   INCLUDING tombstoned rows) as a snapshot.
 * - Merging compares row-by-row, matched by IDENTITY KEY:
 *     · normally the UUID id;
 *     · tables with a natural UNIQUE constraint (scores = one row per
 *       column+student cell, grading_periods = one per subject+type,
 *       attendance_config = one per period) match by that natural key
 *       instead. Two devices can create "the same" row independently with
 *       different UUIDs — matching by natural key makes that an ordinary
 *       newest-wins conflict (the winner's id is adopted on both sides)
 *       instead of a UNIQUE-constraint crash.
 *     · row only in peer   → insert (tombstone and all)
 *     · row in both        → newer updated_at wins, whole row
 *     · row only local     → keep
 * - Exact updated_at ties with different content resolve by device id
 *   (higher id wins) — both devices compute the same winner, so the two
 *   databases always converge.
 * - Deletions carry as tombstones (deleted_at set), never as absence, so a
 *   deleted row can never be resurrected by an old snapshot.
 * - The merge is idempotent: re-merging an already-applied snapshot yields
 *   zero decisions.
 */

export const FORMAT_VERSION = 1;
// Snapshot COMPATIBILITY version: bump ONLY when SYNCED_TABLES' shape changes
// (a device refuses snapshots from a newer shape and asks to be updated).
// Independent from the database migration version in src/lib/migrations.js —
// local-only tables (like sync_conflicts) never affect this number.
//   v2: purged_at + deleted_by_device_id on subjects/student_groups (recycle bin)
//   v3: suffix on students/group_students (name suffixes: Jr., III, …)
//   v4: attendance_source on assessment_columns (score ⇒ auto-Present)
//   v5: subject_code on subjects
export const SCHEMA_VERSION = 5;

// Parents strictly before children (foreign-key safe application order).
// `naturalKey` marks tables whose rows have an identity beyond their UUID —
// it is both the merge-matching key and the ON CONFLICT target when applying.
export const SYNCED_TABLES = [
  {
    name: 'subjects',
    columns: ['id', 'name', 'subject_code', 'section', 'school_year', 'semester', 'prelim_weight', 'midterm_weight', 'final_weight', 'owner_device_id', 'created_at', 'updated_at', 'deleted_at', 'purged_at', 'deleted_by_device_id'],
    // Fields ADDED after the first release: snapshots from older app versions
    // don't carry them — import with the schema default, never null.
    defaults: { subject_code: '' },
  },
  {
    name: 'grading_periods',
    columns: ['id', 'subject_id', 'type', 'created_at', 'updated_at', 'deleted_at'],
    naturalKey: ['subject_id', 'type'],
  },
  {
    name: 'students',
    columns: ['id', 'subject_id', 'last_name', 'first_name', 'middle_name', 'suffix', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
    defaults: { suffix: '' },
  },
  {
    name: 'assessments',
    columns: ['id', 'period_id', 'name', 'is_exam', 'sort_order', 'weight_percent', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'assessment_columns',
    columns: ['id', 'assessment_id', 'date', 'max_score', 'attendance_source', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
    defaults: { attendance_source: 0 },
  },
  {
    name: 'scores',
    columns: ['id', 'column_id', 'student_id', 'value', 'created_at', 'updated_at', 'deleted_at'],
    naturalKey: ['column_id', 'student_id'],
  },
  {
    name: 'attendance_config',
    columns: ['id', 'period_id', 'present_score', 'late_score', 'absent_score', 'created_at', 'updated_at', 'deleted_at'],
    naturalKey: ['period_id'],
  },
  {
    name: 'student_groups',
    columns: ['id', 'name', 'description', 'owner_device_id', 'created_at', 'updated_at', 'deleted_at', 'purged_at', 'deleted_by_device_id'],
  },
  {
    name: 'group_students',
    columns: ['id', 'group_id', 'last_name', 'first_name', 'middle_name', 'suffix', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
    defaults: { suffix: '' },
  },
];

/** The identity key of one row within its table (natural key, else UUID). */
export function rowKey(table, row) {
  if (!table.naturalKey) return String(row.id);
  return table.naturalKey.map(c => String(row[c])).join('|'); // UUIDs/types never contain '|'
}

/** Normalize a cell for comparison (null-ish unified; numbers as numbers). */
function norm(v) {
  if (v === undefined || v === null) return null;
  return v;
}

/** True when two rows are identical across the given columns. */
export function rowsEqual(a, b, columns) {
  for (const c of columns) {
    if (norm(a[c]) !== norm(b[c])) return false;
  }
  return true;
}

/**
 * Project a row onto exactly the synced columns (drops anything extra).
 * Fields the row does not carry — snapshots from OLDER app versions predate
 * later-added columns — are filled from `defaults` (never null into a
 * NOT NULL column), or null for genuinely nullable fields.
 */
export function pickColumns(row, columns, defaults = {}) {
  const out = {};
  for (const c of columns) {
    out[c] = row[c] === undefined ? (defaults[c] ?? null) : row[c];
  }
  return out;
}

/**
 * Decide which version of one row wins.
 * Returns 'peer' or 'local'. Deterministic on both devices.
 */
export function pickWinner(localRow, peerRow, localDeviceId, peerDeviceId) {
  const lt = String(localRow.updated_at || '');
  const pt = String(peerRow.updated_at || '');
  if (pt > lt) return 'peer';
  if (pt < lt) return 'local';
  // Exact timestamp tie with differing content: the higher device id wins on
  // BOTH devices (each evaluates the same comparison), so they converge.
  return String(peerDeviceId) > String(localDeviceId) ? 'peer' : 'local';
}

/**
 * Merge one table. Returns the rows to insert, the rows to overwrite locally,
 * and the peer rows REJECTED by a differing local winner (`rejects` — applied
 * nowhere, but the conflict log needs to know a competing version existed).
 * Never mutates inputs.
 */
export function mergeTable(table, localRows, peerRows, { localDeviceId, peerDeviceId }) {
  const localByKey = new Map((localRows || []).map(r => [rowKey(table, r), r]));
  const inserts = [];
  const updates = [];
  const rejects = [];
  for (const peerRaw of peerRows || []) {
    if (!peerRaw || !peerRaw.id) continue; // malformed row: skip defensively
    const peerRow = pickColumns(peerRaw, table.columns, table.defaults);
    const local = localByKey.get(rowKey(table, peerRow));
    if (!local) {
      inserts.push(peerRow);
      continue;
    }
    if (rowsEqual(local, peerRow, table.columns)) continue; // no-op
    if (pickWinner(local, peerRow, localDeviceId, peerDeviceId) === 'peer') {
      // Whole row wins — id included, so independently-created twins converge
      // to the winner's UUID on both devices.
      updates.push(peerRow);
    } else {
      rejects.push({ peer: peerRow, local });
    }
  }
  return { inserts, updates, rejects };
}

/**
 * Merge a full peer snapshot against local state.
 * `localState` / `peerTables`: { [tableName]: rows[] }.
 * Returns per-table decisions plus totals — the caller applies them in
 * SYNCED_TABLES order inside one transaction.
 */
export function mergeSnapshots(localState, peerTables, ctx) {
  const decisions = {};
  let inserts = 0;
  let updates = 0;
  for (const table of SYNCED_TABLES) {
    const d = mergeTable(table, localState[table.name] || [], (peerTables || {})[table.name] || [], ctx);
    decisions[table.name] = d;
    inserts += d.inserts.length;
    updates += d.updates.length;
  }
  return { decisions, totals: { inserts, updates, applied: inserts + updates } };
}

/** Validate a parsed snapshot's envelope. Returns null if ok, else a reason. */
export function snapshotProblem(snapshot, ownDeviceId) {
  if (!snapshot || typeof snapshot !== 'object') return 'unreadable';
  if (snapshot.format_version !== FORMAT_VERSION) return 'unsupported-format';
  if (typeof snapshot.schema_version !== 'number') return 'unreadable';
  if (snapshot.schema_version > SCHEMA_VERSION) return 'peer-has-newer-schema';
  if (!snapshot.device_id) return 'unreadable';
  if (snapshot.device_id === ownDeviceId) return 'own-snapshot';
  if (!snapshot.tables || typeof snapshot.tables !== 'object') return 'unreadable';
  return null;
}
