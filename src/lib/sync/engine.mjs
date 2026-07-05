/**
 * Sync merge engine — PURE functions only. No database, no filesystem, no
 * network. Everything here is deterministic and unit-testable with plain
 * fixtures (see scripts/test-sync-engine.mjs).
 *
 * Model (per the agreed spec):
 * - Each device exports its FULL state (every row of every synced table,
 *   INCLUDING tombstoned rows) as a snapshot.
 * - Merging compares row-by-row, matched by UUID:
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
export const SCHEMA_VERSION = 1;

// Parents strictly before children (foreign-key safe application order).
export const SYNCED_TABLES = [
  {
    name: 'subjects',
    columns: ['id', 'name', 'section', 'school_year', 'semester', 'prelim_weight', 'midterm_weight', 'final_weight', 'owner_device_id', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'grading_periods',
    columns: ['id', 'subject_id', 'type', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'students',
    columns: ['id', 'subject_id', 'last_name', 'first_name', 'middle_name', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'assessments',
    columns: ['id', 'period_id', 'name', 'is_exam', 'sort_order', 'weight_percent', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'assessment_columns',
    columns: ['id', 'assessment_id', 'date', 'max_score', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'scores',
    columns: ['id', 'column_id', 'student_id', 'value', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'attendance_config',
    columns: ['id', 'period_id', 'present_score', 'late_score', 'absent_score', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'student_groups',
    columns: ['id', 'name', 'description', 'owner_device_id', 'created_at', 'updated_at', 'deleted_at'],
  },
  {
    name: 'group_students',
    columns: ['id', 'group_id', 'last_name', 'first_name', 'middle_name', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  },
];

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

/** Project a row onto exactly the synced columns (drops anything extra). */
export function pickColumns(row, columns) {
  const out = {};
  for (const c of columns) out[c] = row[c] === undefined ? null : row[c];
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
 * Merge one table. Returns the rows to insert and the rows to overwrite
 * locally. Never mutates inputs.
 */
export function mergeTable(table, localRows, peerRows, { localDeviceId, peerDeviceId }) {
  const localById = new Map((localRows || []).map(r => [r.id, r]));
  const inserts = [];
  const updates = [];
  for (const peerRaw of peerRows || []) {
    if (!peerRaw || !peerRaw.id) continue; // malformed row: skip defensively
    const peerRow = pickColumns(peerRaw, table.columns);
    const local = localById.get(peerRow.id);
    if (!local) {
      inserts.push(peerRow);
      continue;
    }
    if (rowsEqual(local, peerRow, table.columns)) continue; // no-op
    if (pickWinner(local, peerRow, localDeviceId, peerDeviceId) === 'peer') {
      updates.push(peerRow);
    }
  }
  return { inserts, updates };
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
