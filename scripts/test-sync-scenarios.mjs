/**
 * Sync scenario regression tests — drives TWO live app instances through the
 * real-world two-laptop scenarios via the actual HTTP APIs, with a real
 * shared sync folder. Covers: disjoint merges, same-cell newest-wins,
 * independently-created twins (natural-key convergence), late-syncer safety,
 * repeated-alternation convergence, the conflict audit log, and the conflict
 * review flow (unreviewed badge counts, restore-as-new-edit, mark-reviewed).
 *
 * Usage (two fresh instances + shared folder):
 *   mkdir -p /tmp/sync-lab/{a,b,share}
 *   GRADEBOOK_DATA_DIR=/tmp/sync-lab/a PORT=3131 node .next/standalone/server.js &
 *   GRADEBOOK_DATA_DIR=/tmp/sync-lab/b PORT=3132 node .next/standalone/server.js &
 *   node scripts/test-sync-scenarios.mjs
 */
const A = 3131, B = 3132;
const url = (port, p) => `http://127.0.0.1:${port}${p}`;

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
  if (!ok) failures++;
};
const j = async (port, method, path, body) => {
  const res = await fetch(url(port, path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};
const must = async (port, method, path, body) => {
  const r = await j(port, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} on :${port} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sync = (port) => j(port, 'POST', '/api/sync/run', {});
const scores = async (port, subj) => (await must(port, 'GET', `/api/subjects/${subj}/scores`));
const cell = (sc, col, st) => sc?.[col]?.[st];

// ---------- Setup: subject born on A, mirrored to B ----------
await must(A, 'PUT', '/api/sync', { sync_folder: '/tmp/sync-lab/share' });
await must(B, 'PUT', '/api/sync', { sync_folder: '/tmp/sync-lab/share' });

const { id: subj } = await must(A, 'POST', '/api/subjects', {
  name: 'Networking', section: 'BSIT-3B', school_year: '2026-2027', semester: '1st',
});
await must(A, 'POST', `/api/subjects/${subj}/init`, {
  periods: ['PRELIM', 'MIDTERM', 'FINAL'].map(type => ({
    type,
    assessments: [
      { name: 'Attendance', is_exam: 0, weight_percent: 0 },
      { name: 'Quiz', is_exam: 0, weight_percent: 0 },
      { name: 'Exam', is_exam: 1, weight_percent: 0 },
    ],
  })),
});
const st = [];
for (const [l, f] of [['Uno', 'Alpha'], ['Dos', 'Beta'], ['Tres', 'Gamma']]) {
  st.push((await must(A, 'POST', `/api/subjects/${subj}/students`, { last_name: l, first_name: f })).id);
}
const periods = await must(A, 'GET', `/api/subjects/${subj}/periods`);
const quiz = periods[0].assessments.find(a => a.name === 'Quiz');
const cols = [];
for (let i = 1; i <= 4; i++) {
  cols.push((await must(A, 'POST', `/api/assessments/${quiz.id}/columns`, { date: `2026-07-0${i}`, max_score: 10 })).id);
}
let r = await sync(A);
check('setup: A first sync ok', r.data?.ok === true);
r = await sync(B);
check('setup: B mirrors subject', r.data?.ok === true && (await must(B, 'GET', `/api/subjects/${subj}`))?.name === 'Networking');

// ---------- S3: different students edited on each laptop ----------
await must(A, 'PUT', `/api/students/${st[0]}`, { last_name: 'Uno', first_name: 'Alpha', middle_name: 'A' });
await must(B, 'PUT', `/api/students/${st[1]}`, { last_name: 'Dos', first_name: 'Beta', middle_name: 'B' });
await sync(A); await sync(B); await sync(A);
const stuA = await must(A, 'GET', `/api/subjects/${subj}/students`);
const stuB = await must(B, 'GET', `/api/subjects/${subj}/students`);
check('S3: both student edits survive on BOTH laptops',
  stuA.find(s => s.id === st[0])?.middle_name === 'A' && stuA.find(s => s.id === st[1])?.middle_name === 'B' &&
  stuB.find(s => s.id === st[0])?.middle_name === 'A' && stuB.find(s => s.id === st[1])?.middle_name === 'B');

// ---------- S5: different cells of the SAME assessment ----------
await must(A, 'PUT', `/api/scores/${cols[0]}/${st[0]}`, { value: 5 });
await must(B, 'PUT', `/api/scores/${cols[0]}/${st[1]}`, { value: 6 });
await sync(A); await sync(B); await sync(A);
const s5a = await scores(A, subj), s5b = await scores(B, subj);
check('S5: both cell entries survive on BOTH laptops',
  cell(s5a, cols[0], st[0]) === 5 && cell(s5a, cols[0], st[1]) === 6 &&
  cell(s5b, cols[0], st[0]) === 5 && cell(s5b, cols[0], st[1]) === 6);

// ---------- S6a: same cell, row already known to both (edit vs edit) ----------
await must(A, 'PUT', `/api/scores/${cols[1]}/${st[0]}`, { value: 7 });
await sync(A); await sync(B); // both laptops now have this row (same UUID)
await sleep(30);
await must(A, 'PUT', `/api/scores/${cols[1]}/${st[0]}`, { value: 7.5 }); // earlier edit on A
await sleep(30);
await must(B, 'PUT', `/api/scores/${cols[1]}/${st[0]}`, { value: 9 });   // later edit on B
await sync(A); await sync(B); await sync(A);
const s6a = await scores(A, subj), s6b = await scores(B, subj);
check('S6 (known row): later edit wins on BOTH laptops (LWW), earlier value silently gone',
  cell(s6a, cols[1], st[0]) === 9 && cell(s6b, cols[1], st[0]) === 9);

// ---------- S7: one laptop syncs, the other keeps working then syncs late ----------
await must(A, 'PUT', `/api/scores/${cols[2]}/${st[1]}`, { value: 1 });
await sync(A);                       // A publishes
await sleep(30);
await must(B, 'PUT', `/api/scores/${cols[2]}/${st[2]}`, { value: 2 });   // B works on, stale
await sleep(30);
r = await sync(B); // B late-syncs: imports A's work, publishes its own
await sync(A);
const s7a = await scores(A, subj), s7b = await scores(B, subj);
check('S7: late syncer loses nothing and clobbers nothing',
  cell(s7a, cols[2], st[1]) === 1 && cell(s7a, cols[2], st[2]) === 2 &&
  cell(s7b, cols[2], st[1]) === 1 && cell(s7b, cols[2], st[2]) === 2);

// ---------- S8: weeks of switching — convergence loop ----------
for (let round = 0; round < 5; round++) {
  const dev = round % 2 === 0 ? A : B;
  await must(dev, 'PUT', `/api/scores/${cols[0]}/${st[2]}`, { value: round + 1 });
  await must(dev, 'PUT', `/api/students/${st[2]}`, { last_name: 'Tres', first_name: 'Gamma', middle_name: String(round) });
  if (round % 2 === 0) { await sync(A); await sync(B); } else { await sync(B); await sync(A); }
  await sleep(20);
}
await sync(A); await sync(B); await sync(A);
const dump = async (port) => JSON.stringify({
  students: await must(port, 'GET', `/api/subjects/${subj}/students`),
  scores: await scores(port, subj),
  periods: await must(port, 'GET', `/api/subjects/${subj}/periods`),
});
check('S8: after alternating rounds both databases are byte-identical', (await dump(A)) === (await dump(B)));

// ---------- S6b: same EMPTY cell filled independently on both laptops ----------
// No sync in between — each device created its OWN row (different UUIDs) for
// the same (column, student). This used to crash sync with a UNIQUE error.
await must(A, 'PUT', `/api/scores/${cols[3]}/${st[0]}`, { value: 5 });
await sleep(30);
await must(B, 'PUT', `/api/scores/${cols[3]}/${st[0]}`, { value: 6 }); // later → should win
const rA = await sync(A); // A exports its row
const rB = await sync(B); // B imports A's twin — natural-key merge, B's later row wins
const rA2 = await sync(A); // A imports B's winner
const rB2 = await sync(B);
check('S6b: no crash — every sync run succeeds',
  [rA, rB, rA2, rB2].every(r => r.status === 200 && r.data?.ok === true),
  [rA, rB, rA2, rB2].map(r => r.status).join('/'));
const s6ba = await scores(A, subj), s6bb = await scores(B, subj);
check('S6b: both laptops converged on the LATER value (6)',
  cell(s6ba, cols[3], st[0]) === 6 && cell(s6bb, cols[3], st[0]) === 6,
  `A=${cell(s6ba, cols[3], st[0])} B=${cell(s6bb, cols[3], st[0])}`);

// ---------- Conflict audit log ----------
// Both real conflicts (S6a: 7.5 vs 9, S6b: 5 vs 6) were DECIDED on laptop B
// (its local value won there) — so B carries both entries. A's overwrites
// were informed propagation of already-decided winners. Ordinary propagation
// (S3/S5/S7/S8 received edits) must NOT appear as conflicts anywhere.
const confA = (await must(A, 'GET', '/api/sync/conflicts')).conflicts;
const confB = (await must(B, 'GET', '/api/sync/conflicts')).conflicts;
console.log('conflicts on B:', confB.map(c => `${c.label}: kept ${c.kept} / replaced ${c.discarded}`).join(' || '));
console.log('conflicts on A:', confA.map(c => `${c.label}: kept ${c.kept} / replaced ${c.discarded}`).join(' || ') || '(none)');
check('LOG: B recorded exactly the 2 real conflicts (decided there)', confB.length === 2, `got ${confB.length}`);
check('LOG: A recorded none (its overwrites were informed propagation)', confA.length === 0, `got ${confA.length}`);
const s6aLog = confB.find(c => c.discarded === '7.5');
const s6bLog = confB.find(c => c.discarded === '5');
check('LOG: S6a entry says kept 9, replaced 7.5', s6aLog?.kept === '9');
check('LOG: S6b entry says kept 6, replaced 5', s6bLog?.kept === '6');
check('LOG: entries carry readable context (student + assessment)',
  !!s6aLog && /Score of Uno, Alpha/.test(s6aLog.label) && /Quiz/.test(s6aLog.label));

// ---------- S9: recycle bin across laptops ----------
// Delete on A → B sees it gone AND in its bin; restore on B → A gets it back
// with every score; permanent delete propagates; no duplicates anywhere.
// updated_at changes on restore BY DESIGN (the revival must win in sync),
// so compare everything except volatile bookkeeping fields.
const stripVolatile = (o) => JSON.parse(JSON.stringify(o), (k, v) =>
  (k === 'updated_at' || k === 'deleted_by_device_id' || k === 'purged_at' ? undefined : v));
const preDelete = JSON.stringify(stripVolatile({
  students: await must(A, 'GET', `/api/subjects/${subj}/students`),
  scores: await scores(A, subj),
}));
await must(A, 'DELETE', `/api/subjects/${subj}`);
await sync(A); await sync(B);
check('S9: deletion propagates (gone from B main list)',
  !(await must(B, 'GET', '/api/subjects')).some(s => s.id === subj));
const binB = await must(B, 'GET', '/api/recycle-bin');
check('S9: B recycle bin lists it with the deleting laptop',
  binB.subjects.some(s => s.id === subj && s.deleted_by));

await must(B, 'POST', `/api/subjects/${subj}/restore`);
await sync(B); await sync(A);
check('S9: restore on B propagates back to A',
  (await must(A, 'GET', '/api/subjects')).some(s => s.id === subj));
const postRestore = JSON.stringify(stripVolatile({
  students: await must(A, 'GET', `/api/subjects/${subj}/students`),
  scores: await scores(A, subj),
}));
check('S9: A has identical students + scores after the round trip', preDelete === postRestore);
check('S9: no duplicates after restore',
  (await must(A, 'GET', '/api/subjects')).filter(s => s.id === subj).length === 1 &&
  (await must(B, 'GET', '/api/subjects')).filter(s => s.id === subj).length === 1);

// Permanent-delete propagation via a group.
const { id: grp } = await must(A, 'POST', '/api/groups', { name: 'Purge Me', description: '' });
await sync(A); await sync(B);
await must(A, 'DELETE', `/api/groups/${grp}`);
await sync(A); await sync(B);
check('S9: deleted group shows in B bin', (await must(B, 'GET', '/api/recycle-bin')).groups.some(g => g.id === grp));
await must(A, 'POST', `/api/groups/${grp}/purge`);
await sync(A); await sync(B);
check('S9: permanent delete propagates (gone from B bin too)',
  !(await must(B, 'GET', '/api/recycle-bin')).groups.some(g => g.id === grp));

// ---------- S10: conflict review — badge, restore, mark-as-reviewed ----------
// A and B edit the same cell concurrently; B's later edit wins everywhere
// (normal LWW). The user reviews on B — where the conflict was decided —
// and restores A's value. The restore must behave as an ORDINARY edit:
// win on both laptops via normal sync and log NO new conflict anywhere.
await must(A, 'PUT', `/api/scores/${cols[1]}/${st[2]}`, { value: 3 });   // A first
await sleep(30);
await must(B, 'PUT', `/api/scores/${cols[1]}/${st[2]}`, { value: 4 });   // B later → wins
await sync(A); // A publishes 3
await sync(B); // B imports 3, keeps its later 4 → conflict decided + logged on B
await sync(A); // A follows to 4 (informed overwrite — not a conflict on A)
check('S10: later edit won on both laptops',
  cell(await scores(A, subj), cols[1], st[2]) === 4 && cell(await scores(B, subj), cols[1], st[2]) === 4);

const statB = await must(B, 'GET', '/api/sync');
check('S10: B status counts 3 unreviewed conflicts (badge source)', statB.unreviewed_conflicts === 3, `got ${statB.unreviewed_conflicts}`);
check('S10: A status stays clean', (await must(A, 'GET', '/api/sync')).unreviewed_conflicts === 0);

const listB = await must(B, 'GET', `/api/sync/conflicts?subjectId=${subj}&unreviewedOnly=1`);
check('S10: subject filter finds all three (contextual banner source)', listB.conflicts.length === 3, `got ${listB.conflicts.length}`);
const target = listB.conflicts.find(c => c.discarded === '3' && c.kept === '4');
check('S10: the new entry is restorable with readable context',
  !!target && target.restorable === true && /Score of Tres, Gamma/.test(target.label));

const rest = await must(B, 'POST', '/api/sync/conflicts/restore', { id: target.id });
check('S10: restore reports what it brought back', rest.ok === true && rest.restored === '3');
check('S10: B grid shows the restored value', cell(await scores(B, subj), cols[1], st[2]) === 3);
check('S10: restoring marked that conflict reviewed', (await must(B, 'GET', '/api/sync')).unreviewed_conflicts === 2);

await sync(B); await sync(A);
check('S10: restored value propagates to A (plain edit, normal sync)',
  cell(await scores(A, subj), cols[1], st[2]) === 3);
check('S10: the restore logged NO new conflict on A', (await must(A, 'GET', '/api/sync')).unreviewed_conflicts === 0);
check('S10: …and none on B', (await must(B, 'GET', '/api/sync')).unreviewed_conflicts === 2);

const marked = await must(B, 'PUT', '/api/sync/conflicts', { all: true });
check('S10: mark-all reviews the remaining two', marked.reviewed === 2 && marked.unreviewed === 0);
const afterAll = await must(B, 'GET', '/api/sync/conflicts');
check('S10: history keeps every entry, all with reviewed_at set',
  afterAll.conflicts.length === 3 && afterAll.conflicts.every(c => !!c.reviewed_at));

// ---------- S11: conflict DETAILS — gradebook-language context ----------
// The details endpoint must render a conflict the way the gradebook does:
// subject/period/assessment/student context, a miniature-gradebook
// comparison for scores, and a field comparison for structural rows.

// Score details (reuse the S10 entry — reviewed entries stay inspectable).
const allB = await must(B, 'GET', '/api/sync/conflicts');
const scoreConf = allB.conflicts.find(c => c.table_name === 'scores' && c.discarded === '3');
const det = await must(B, 'GET', `/api/sync/conflicts/${scoreConf.id}`);
const ctx1 = Object.fromEntries(det.context.map(x => [x.label, x.value]));
check('S11: score details carry full gradebook context',
  ctx1['Subject'] === 'Networking' && ctx1['Grading Period'] === 'PRELIM' &&
  ctx1['Assessment'] === 'Quiz' && /Tres, Gamma/.test(ctx1['Student'] || ''),
  JSON.stringify(ctx1));
check('S11: mini-gradebook marks the conflicted row among roster neighbors',
  det.comparison?.type === 'score-grid' &&
  det.comparison.students.length >= 2 &&
  det.comparison.students.some(s => s.conflicted && /Tres, Gamma/.test(s.name)) &&
  det.comparison.students.some(s => !s.conflicted));
const tgt = det.comparison.students.find(s => s.conflicted);
check('S11: previous and CURRENT (live) values shown', tgt.before === '3' && tgt.after === '3');
check('S11: superseded flag set (the restore changed the cell after the decision)',
  det.comparison.superseded === true);

// Column conflict: max score edited on both laptops → fields comparison.
await must(A, 'PUT', `/api/columns/${cols[2]}`, { max_score: 15 });
await sleep(30);
await must(B, 'PUT', `/api/columns/${cols[2]}`, { max_score: 20 }); // later → wins
await sync(A); await sync(B); await sync(A);
const listB3 = await must(B, 'GET', '/api/sync/conflicts?unreviewedOnly=1');
const colConf = listB3.conflicts.find(c => c.table_name === 'assessment_columns');
check('S11: column conflict logged with a contextual label',
  !!colConf && /Quiz/.test(colConf.label) && /Networking/.test(colConf.label), colConf?.label);
const det2 = await must(B, 'GET', `/api/sync/conflicts/${colConf.id}`);
const ctx2 = Object.fromEntries(det2.context.map(x => [x.label, x.value]));
check('S11: column details name subject, period, assessment',
  ctx2['Subject'] === 'Networking' && ctx2['Grading Period'] === 'PRELIM' && ctx2['Assessment'] === 'Quiz');
const maxField = det2.comparison?.fields?.find(f => f.key === 'max_score');
check('S11: field comparison flags exactly the max-score change',
  det2.comparison?.type === 'fields' && maxField?.before === '15' && maxField?.after === '20' && maxField?.changed === true &&
  det2.comparison.fields.find(f => f.key === 'date')?.changed === false);

// Restore through the same flow the confirm dialog uses.
check('S11: restore of the column conflict succeeds',
  (await must(B, 'POST', '/api/sync/conflicts/restore', { id: colConf.id })).ok === true);
const quizColB = (await must(B, 'GET', `/api/subjects/${subj}/periods`))[0]
  .assessments.find(a => a.name === 'Quiz').columns.find(c => c.id === cols[2]);
check('S11: max score restored on B', String(quizColB.max_score) === '15', `got ${quizColB.max_score}`);
await sync(B); await sync(A);
const quizColA = (await must(A, 'GET', `/api/subjects/${subj}/periods`))[0]
  .assessments.find(a => a.name === 'Quiz').columns.find(c => c.id === cols[2]);
check('S11: restored max propagates to A with no new conflicts',
  String(quizColA.max_score) === '15' && (await must(A, 'GET', '/api/sync')).unreviewed_conflicts === 0);
check('S11: unknown conflict id → 404', (await j(B, 'GET', '/api/sync/conflicts/nope')).status === 404);

console.log(failures ? `\n${failures} FAILURES` : '\nALL SCENARIO TESTS PASSED');
process.exit(failures ? 1 : 0);
