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
  snapshotProblem,
  FORMAT_VERSION,
  SCHEMA_VERSION,
} from '../src/lib/sync/engine.mjs';

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
  id: 's1', name: 'BPM', section: 'X', school_year: '2026-2027', semester: '1st',
  prelim_weight: 30, midterm_weight: 30, final_weight: 40,
  owner_device_id: A, created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null, ...over,
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
  const next = structuredClone(state);
  for (const table of SYNCED_TABLES) {
    const d = decisions[table.name];
    const byId = new Map(next[table.name].map(r => [r.id, r]));
    for (const row of [...d.inserts, ...d.updates]) byId.set(row.id, row);
    next[table.name] = [...byId.values()];
  }
  return next;
};
{
  // Simulate: A has a subject tree + group; B has its own subject; cross-sync.
  const stateA = emptyState();
  stateA.subjects = [subj()];
  stateA.grading_periods = [{ id: 'p1', subject_id: 's1', type: 'PRELIM', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null }];
  stateA.assessments = [{ id: 'a1', period_id: 'p1', name: 'Quiz', is_exam: 0, sort_order: 0, weight_percent: 50, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-05T00:00:00.000Z', deleted_at: null }];
  stateA.student_groups = [{ id: 'g1', name: 'BSIS 2A', description: '', owner_device_id: A, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', deleted_at: null }];

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

console.log(failures === 0 ? '\nALL ENGINE TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
