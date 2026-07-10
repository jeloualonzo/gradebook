/**
 * Exhaustive unit tests for the pure sync merge engine.
 * Run: node scripts/test-sync-engine.mjs   (exits non-zero on any failure)
 */
import {
  SYNCED_TABLES,
  mergeTable,
  mergeSnapshots,
  pickWinner,
  rowsEqual,
  rowKey,
  snapshotProblem,
  FORMAT_VERSION,
  SCHEMA_VERSION,
} from '../src/lib/sync/engine.mjs';
import { semanticallyEqual } from '../src/lib/sync/review.mjs';

let failures = 0;
const t = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const SUBJECTS = SYNCED_TABLES.find(x => x.name === 'subjects');
const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';
const ctxOnA = { localDeviceId: A, peerDeviceId: B }; // merging B's snapshot on A
const ctxOnB = { localDeviceId: B, peerDeviceId: A }; // merging A's snapshot on B

const subj = (over = {}) => ({
  id: 's1', name: 'BPM', subject_code: '', section: 'X', school_year: '2026-2027', semester: '1st',
  prelim_weight: 30, midterm_weight: 30, final_weight: 40,
  owner_device_id: A, created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null,
  purged_at: null, deleted_by_device_id: null, ...over,
});

// ---- 1. basic row rules -----------------------------------------------------
{
  const d = mergeTable(SUBJECTS, [], [subj()], ctxOnA);
  t('row only in peer → insert', d.inserts.length === 1 && d.updates.length === 0);
}
{
  const d = mergeTable(SUBJECTS, [subj()], [], ctxOnA);
  t('row only local → keep (nothing to do)', d.inserts.length === 0 && d.updates.length === 0);
}
{
  const d = mergeTable(SUBJECTS, [subj()], [subj()], ctxOnA);
  t('identical rows → no-op (idempotence at row level)', d.inserts.length + d.updates.length === 0);
}
{
  const newer = subj({ name: 'BPM v2', updated_at: '2026-07-02T00:00:00.000Z' });
  const d = mergeTable(SUBJECTS, [subj()], [newer], ctxOnA);
  t('newer peer wins → update', d.updates.length === 1 && d.updates[0].name === 'BPM v2');
}
{
  const older = subj({ name: 'BPM old', updated_at: '2026-06-30T00:00:00.000Z' });
  const d = mergeTable(SUBJECTS, [subj()], [older], ctxOnA);
  t('older peer loses → keep local', d.inserts.length + d.updates.length === 0);
}

// ---- 2. equal-timestamp tiebreak (must converge on both devices) ------------
{
  const mineOnA = subj({ name: 'A version' });
  const theirsFromB = subj({ name: 'B version' });
  const onA = mergeTable(SUBJECTS, [mineOnA], [theirsFromB], ctxOnA); // B > A → peer wins
  const onB = mergeTable(SUBJECTS, [theirsFromB], [mineOnA], ctxOnB); // A < B → local wins
  t('tie: higher device id wins on device A (applies peer)', onA.updates.length === 1 && onA.updates[0].name === 'B version');
  t('tie: higher device id wins on device B (keeps local)', onB.updates.length === 0);
}

// ---- 3. tombstones ----------------------------------------------------------
{
  // Peer deleted it AFTER our last edit → tombstone propagates.
  const localAlive = subj();
  const peerDeleted = subj({ deleted_at: '2026-07-03T00:00:00.000Z', updated_at: '2026-07-03T00:00:00.000Z' });
  const d = mergeTable(SUBJECTS, [localAlive], [peerDeleted], ctxOnA);
  t('newer tombstone propagates (delete syncs)', d.updates.length === 1 && d.updates[0].deleted_at !== null);
}
{
  // We deleted it; peer snapshot still has the OLD alive row → must NOT resurrect.
  const localDeleted = subj({ deleted_at: '2026-07-03T00:00:00.000Z', updated_at: '2026-07-03T00:00:00.000Z' });
  const peerStaleAlive = subj();
  const d = mergeTable(SUBJECTS, [localDeleted], [peerStaleAlive], ctxOnA);
  t('old alive row does NOT resurrect a newer tombstone', d.inserts.length + d.updates.length === 0);
}
{
  // Deliberate revive: peer re-created (deleted_at null) NEWER than our tombstone.
  const localDeleted = subj({ deleted_at: '2026-07-03T00:00:00.000Z', updated_at: '2026-07-03T00:00:00.000Z' });
  const peerRevived = subj({ deleted_at: null, updated_at: '2026-07-04T00:00:00.000Z' });
  const d = mergeTable(SUBJECTS, [localDeleted], [peerRevived], ctxOnA);
  t('newer revive beats older tombstone', d.updates.length === 1 && d.updates[0].deleted_at === null);
}
{
  // Tombstones transfer to a device that never saw the row at all.
  const peerDeleted = subj({ deleted_at: '2026-07-03T00:00:00.000Z', updated_at: '2026-07-03T00:00:00.000Z' });
  const d = mergeTable(SUBJECTS, [], [peerDeleted], ctxOnA);
  t('unknown tombstoned row inserts AS tombstone (absence ≠ deletion)', d.inserts.length === 1 && d.inserts[0].deleted_at !== null);
}

// ---- 4. full-snapshot merge + idempotence + convergence ---------------------
const emptyState = () => Object.fromEntries(SYNCED_TABLES.map(x => [x.name, []]));
const applyDecisions = (state, decisions) => {
  // Mirrors the real apply: rows land on their IDENTITY key (natural key
  // where defined), so a winning twin REPLACES the local one it displaces.
  const next = structuredClone(state);
  for (const table of SYNCED_TABLES) {
    const d = decisions[table.name];
    const byKey = new Map(next[table.name].map(r => [rowKey(table, r), r]));
    for (const row of [...d.inserts, ...d.updates]) byKey.set(rowKey(table, row), row);
    next[table.name] = [...byKey.values()];
  }
  return next;
};
{
  // Simulate: A has a subject tree + group; B has its own subject; cross-sync.
  const stateA = emptyState();
  stateA.subjects = [subj()];
  stateA.grading_periods = [{ id: 'p1', subject_id: 's1', type: 'PRELIM', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null }];
  stateA.assessments = [{ id: 'a1', period_id: 'p1', name: 'Quiz', is_exam: 0, sort_order: 0, weight_percent: 50, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-05T00:00:00.000Z', deleted_at: null }];
  stateA.student_groups = [{ id: 'g1', name: 'BSIS 2A', description: '', owner_device_id: A, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null, purged_at: null, deleted_by_device_id: null }];

  const stateB = emptyState();
  stateB.subjects = [subj({ id: 's2', name: 'Ethics', owner_device_id: B })];
  // B also has a STALE copy of A's assessment (older) plus a NEWER rename of A's subject.
  stateB.grading_periods = structuredClone(stateA.grading_periods);
  stateB.assessments = [{ ...stateA.assessments[0], name: 'Old Quiz name', updated_at: '2026-07-02T00:00:00.000Z' }];
  stateB.subjects.push(subj({ name: 'BPM (renamed on B)', updated_at: '2026-07-06T00:00:00.000Z' }));

  const mergedOnA = applyDecisions(stateA, mergeSnapshots(stateA, stateB, ctxOnA).decisions);
  const mergedOnB = applyDecisions(stateB, mergeSnapshots(stateB, stateA, ctxOnB).decisions);

  const norm = s => JSON.stringify(Object.fromEntries(SYNCED_TABLES.map(x => [x.name, [...s[x.name]].sort((r1, r2) => r1.id.localeCompare(r2.id))])));
  t('CONVERGENCE: A⇐B and B⇐A end byte-identical', norm(mergedOnA) === norm(mergedOnB));
  t('convergence: newer rename won everywhere', mergedOnA.subjects.find(s => s.id === 's1').name === 'BPM (renamed on B)');
  t('convergence: newer assessment name won everywhere', mergedOnB.assessments.find(a => a.id === 'a1').name === 'Quiz');
  t('convergence: both subjects present on both devices', mergedOnA.subjects.length === 2 && mergedOnB.subjects.length === 2);

  const again = mergeSnapshots(mergedOnA, mergedOnB, ctxOnA);
  t('IDEMPOTENCE: re-merging converged states → zero decisions', again.totals.applied === 0);
}

// ---- 5. snapshot envelope validation ---------------------------------------
{
  const good = { format_version: FORMAT_VERSION, schema_version: SCHEMA_VERSION, device_id: B, tables: {} };
  t('valid snapshot accepted', snapshotProblem(good, A) === null);
  t('own snapshot rejected', snapshotProblem({ ...good, device_id: A }, A) === 'own-snapshot');
  t('newer schema rejected (update-this-laptop case)', snapshotProblem({ ...good, schema_version: SCHEMA_VERSION + 1 }, A) === 'peer-has-newer-schema');
  t('future format rejected', snapshotProblem({ ...good, format_version: 99 }, A) === 'unsupported-format');
  t('garbage rejected', snapshotProblem(null, A) === 'unreadable');
}

// ---- 6. defensive details ---------------------------------------------------
{
  const d = mergeTable(SUBJECTS, [subj()], [{ ...subj(), extra_field: 'junk' }], ctxOnA);
  t('extra fields in peer rows are ignored (projection)', d.inserts.length + d.updates.length === 0);
  const d2 = mergeTable(SUBJECTS, [], [null, {}, { id: null }], ctxOnA);
  t('malformed peer rows are skipped', d2.inserts.length === 0);
  t('winner comparison is symmetric-safe', pickWinner(subj(), subj(), A, B) === 'peer' && pickWinner(subj(), subj(), B, A) === 'local');
  t('rowsEqual treats null/undefined the same', rowsEqual({ id: '1', deleted_at: null }, { id: '1' }, ['id', 'deleted_at']));
}

// ---- 7. natural-key identity: independently created twins -------------------
// Two devices fill the SAME empty score cell offline: each creates its own
// row with its own UUID for one (column_id, student_id). These must merge as
// an ordinary newest-wins conflict — never a UNIQUE-constraint crash.
const SCORES = SYNCED_TABLES.find(x => x.name === 'scores');
const cellRow = (over = {}) => ({
  id: 'id-default', column_id: 'c1', student_id: 'st1', value: 5,
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  deleted_at: null, ...over,
});
{
  t('rowKey: scores use the natural cell key', rowKey(SCORES, cellRow()) === 'c1|st1');
  t('rowKey: subjects use the UUID', rowKey(SUBJECTS, subj()) === 's1');

  const mineOnA = cellRow({ id: 'id-a', value: 5, updated_at: '2026-07-01T10:00:00.000Z' });
  const theirsOnB = cellRow({ id: 'id-b', value: 6, updated_at: '2026-07-01T11:00:00.000Z' }); // later
  const dA = mergeTable(SCORES, [mineOnA], [theirsOnB], ctxOnA);
  const dB = mergeTable(SCORES, [theirsOnB], [mineOnA], ctxOnB);
  t('twins: later twin wins on the earlier device (as UPDATE, not insert)',
    dA.inserts.length === 0 && dA.updates.length === 1 && dA.updates[0].value === 6 && dA.updates[0].id === 'id-b');
  t('twins: later twin keeps its own on the later device', dB.inserts.length + dB.updates.length === 0);

  const stateA = { ...emptyState(), scores: [mineOnA] };
  const stateB = { ...emptyState(), scores: [theirsOnB] };
  const mergedA = applyDecisions(stateA, mergeSnapshots(stateA, stateB, ctxOnA).decisions);
  const mergedB = applyDecisions(stateB, mergeSnapshots(stateB, stateA, ctxOnB).decisions);
  t('twins: ONE row per cell after merge (no duplicates)', mergedA.scores.length === 1 && mergedB.scores.length === 1);
  t('twins: both devices converge to the same row, id included',
    JSON.stringify(mergedA.scores[0]) === JSON.stringify(mergedB.scores[0]) && mergedA.scores[0].id === 'id-b');
  t('twins: idempotent after convergence',
    mergeSnapshots(mergedA, mergedB, ctxOnA).totals.applied === 0);
}
{
  // Exact-timestamp twin tie: the device-id tiebreak must converge ids too.
  const twinA = cellRow({ id: 'id-a', value: 5 });
  const twinB = cellRow({ id: 'id-b', value: 6 });
  const onA = mergeTable(SCORES, [twinA], [twinB], ctxOnA); // peer B has higher device id → wins
  const onB = mergeTable(SCORES, [twinB], [twinA], ctxOnB); // peer A is lower → local wins
  t('twin tie: higher device id wins on both sides',
    onA.updates.length === 1 && onA.updates[0].id === 'id-b' && onB.updates.length === 0);
}
{
  // Defense-in-depth: grading_periods twins (same subject+type) also converge.
  const PERIODS = SYNCED_TABLES.find(x => x.name === 'grading_periods');
  const pA = { id: 'p-a', subject_id: 's1', type: 'PRELIM', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null };
  const pB = { ...pA, id: 'p-b', updated_at: '2026-07-02T00:00:00.000Z' };
  const d = mergeTable(PERIODS, [pA], [pB], ctxOnA);
  t('period twins converge by (subject, type)', d.inserts.length === 0 && d.updates.length === 1 && d.updates[0].id === 'p-b');
}

// ---- 8. forward compatibility: snapshots from OLDER app versions ------------
// A peer that has not updated yet exports rows WITHOUT later-added fields
// (subject_code, suffix, attendance_source). Importing them must fill the
// schema defaults — never null into a NOT NULL column (this exact gap caused
// "apply-failed: NOT NULL constraint failed: subjects.subject_code" during a
// mixed-version window).
{
  const oldSubject = { // as exported before subject_code existed
    id: 's9', name: 'Old App Subject', section: 'X', school_year: '2026-2027', semester: '1st',
    prelim_weight: 30, midterm_weight: 30, final_weight: 40,
    owner_device_id: B, created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null,
  };
  const d = mergeTable(SUBJECTS, [], [oldSubject], ctxOnA);
  t('old snapshot: missing subject_code imports as \'\' (not null)',
    d.inserts.length === 1 && d.inserts[0].subject_code === '');
  t('old snapshot: nullable later fields stay null',
    d.inserts[0].purged_at === null && d.inserts[0].deleted_by_device_id === null);

  const STUDENTS = SYNCED_TABLES.find(x => x.name === 'students');
  const oldStudent = { id: 'st9', subject_id: 's9', last_name: 'Cruz', first_name: 'Ana', middle_name: '', sort_order: 0, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null };
  const ds = mergeTable(STUDENTS, [], [oldStudent], ctxOnA);
  t('old snapshot: missing suffix imports as \'\'', ds.inserts[0].suffix === '');

  const COLUMNS = SYNCED_TABLES.find(x => x.name === 'assessment_columns');
  const oldCol = { id: 'c9', assessment_id: 'a9', date: '2026-07-01', max_score: 10, sort_order: 0, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null };
  const dc = mergeTable(COLUMNS, [], [oldCol], ctxOnA);
  t('old snapshot: missing attendance_source imports as 0', dc.inserts[0].attendance_source === 0);
}

// ---- 9. review semantics (review.mjs — pure) --------------------------------
// The conflict review answers ONE question: "did the two laptops produce
// different gradebook data?" These fixtures pin the boundary between
// bookkeeping (never reviewable) and data (always reviewable). Merge
// behavior is unaffected — review.mjs is consulted by the logger only.
{
  const COLUMNS = SYNCED_TABLES.find(x => x.name === 'assessment_columns');
  const STUDENTS = SYNCED_TABLES.find(x => x.name === 'students');
  const ASSESSMENTS = SYNCED_TABLES.find(x => x.name === 'assessments');
  const T0 = '2026-07-08T06:00:00.000Z';
  const T1 = '2026-07-08T06:12:00.000Z';
  const T2 = '2026-07-08T07:55:00.000Z';
  const col = (over = {}) => ({ id: 'c1', assessment_id: 'a1', date: '2026-07-08', max_score: 10, attendance_source: 0, sort_order: 0, created_at: T0, updated_at: T0, deleted_at: null, ...over });
  const stu = (over = {}) => ({ id: 'st1', subject_id: 's1', last_name: 'Uno', first_name: 'Alpha', middle_name: '', suffix: '', sort_order: 0, created_at: T0, updated_at: T0, deleted_at: null, ...over });
  const asm = (over = {}) => ({ id: 'a1', period_id: 'p1', name: 'Quiz', is_exam: 0, sort_order: 1, weight_percent: 20, created_at: T0, updated_at: T0, deleted_at: null, ...over });

  t('review: updated_at alone is bookkeeping (the attendance re-save case)',
    semanticallyEqual(COLUMNS, col({ updated_at: T2 }), col({ updated_at: T1 })));
  t('review: identical twins (different id + created_at) are not reviewable',
    semanticallyEqual(SCORES, cellRow(), cellRow({ id: 'id-other', created_at: T1, updated_at: T1 })));
  t('review: score 8 vs 9 is a real conflict',
    !semanticallyEqual(SCORES, cellRow({ value: 9, updated_at: T2 }), cellRow({ value: 8, updated_at: T1 })));
  t('review: max score 10 vs 20 is a real conflict',
    !semanticallyEqual(COLUMNS, col({ max_score: 20 }), col()));
  t('review: counts-as-attendance Yes vs No is a real conflict',
    !semanticallyEqual(COLUMNS, col({ attendance_source: 1 }), col()));
  t('review: assessments renamed differently is a real conflict',
    !semanticallyEqual(ASSESSMENTS, asm({ name: 'Seatwork' }), asm({ name: 'Activities' })));
  t('review: deleted vs active is a real conflict',
    !semanticallyEqual(COLUMNS, col({ deleted_at: T2 }), col()));
  t('review: both deleted at different times is the same outcome — not reviewable',
    semanticallyEqual(COLUMNS, col({ deleted_at: T1, updated_at: T1 }), col({ deleted_at: T2, updated_at: T2 })));
  t('review: a column moved to a different assessment is a real conflict',
    !semanticallyEqual(COLUMNS, col({ assessment_id: 'a2' }), col()));
  t('review: column position is user-visible order — a real conflict',
    !semanticallyEqual(COLUMNS, col({ sort_order: 3 }), col()));
  t('review: student sort_order is invisible (rosters are alphabetical) — not reviewable',
    semanticallyEqual(STUDENTS, stu({ sort_order: 5, updated_at: T2 }), stu()));
  t('review: subject owner_device_id is attribution, not data',
    semanticallyEqual(SUBJECTS, subj({ owner_device_id: B, updated_at: T2 }), subj()));
}

console.log(failures === 0 ? '\nALL ENGINE TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
