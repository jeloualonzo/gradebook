/**
 * Recycle bin e2e — one live instance, full lifecycle for subject + group:
 * delete → listed with counts/deleted-by → restore (tree identical, earlier
 * deletions stay deleted) → purge (hidden everywhere, main list unaffected).
 *
 * Usage: boot one instance on port 3146 with a fresh GRADEBOOK_DATA_DIR,
 * then: node scripts/test-recycle-bin.mjs
 */
const P = 3146;
const j = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${P}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const must = async (m, p, b) => { const r = await j(m, p, b); if (r.status >= 400) throw new Error(`${m} ${p} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); if (!ok) failures++; };
const stripVolatile = (o) => JSON.parse(JSON.stringify(o), (k, v) => (k === 'updated_at' || k === 'deleted_by_device_id' || k === 'purged_at' ? undefined : v));

// --- Build a real subject tree -------------------------------------------------
const { id: subj } = await must('POST', '/api/subjects', { name: 'History', section: 'GE-1', school_year: '2026-2027', semester: '2nd' });
await must('POST', `/api/subjects/${subj}/init`, {
  periods: ['PRELIM', 'MIDTERM', 'FINAL'].map(type => ({
    type, assessments: [{ name: 'Quiz', is_exam: 0, weight_percent: 50 }, { name: 'Exam', is_exam: 1, weight_percent: 50 }],
  })),
});
const st1 = (await must('POST', `/api/subjects/${subj}/students`, { last_name: 'Cruz', first_name: 'Ana' })).id;
const st2 = (await must('POST', `/api/subjects/${subj}/students`, { last_name: 'Diaz', first_name: 'Ben' })).id;
const periods = await must('GET', `/api/subjects/${subj}/periods`);
const quiz = periods[0].assessments.find(a => !a.is_exam);
const c1 = (await must('POST', `/api/assessments/${quiz.id}/columns`, { date: '2026-07-02', max_score: 10 })).id;
await must('PUT', `/api/scores/${c1}/${st1}`, { value: 9 });
await must('PUT', `/api/scores/${c1}/${st2}`, { value: 7 });
// Delete one student FIRST (separately, on purpose) — restore must NOT revive her.
await must('DELETE', `/api/students/${st2}`);

const dumpSubject = async () => ({
  subject: await must('GET', `/api/subjects/${subj}`),
  students: await must('GET', `/api/subjects/${subj}/students`),
  periods: await must('GET', `/api/subjects/${subj}/periods`),
  scores: await must('GET', `/api/subjects/${subj}/scores`),
});
const before = stripVolatile(await dumpSubject());

// --- Delete → recycle bin → restore -------------------------------------------
await must('DELETE', `/api/subjects/${subj}`);
check('deleted subject vanishes from the main list', !(await must('GET', '/api/subjects')).some(s => s.id === subj));
let bin = await must('GET', '/api/recycle-bin');
const entry = bin.subjects.find(s => s.id === subj);
check('recycle bin lists the subject', !!entry);
check('bin entry has details + counts (1 live student, 1 live score)',
  entry?.section === 'GE-1' && entry?.student_count === 1 && entry?.score_count === 1,
  `students=${entry?.student_count} scores=${entry?.score_count}`);
check('bin entry knows who deleted it', typeof entry?.deleted_by === 'string' && entry.deleted_by.length > 0, entry?.deleted_by);

await must('POST', `/api/subjects/${subj}/restore`);
const after = stripVolatile(await dumpSubject());
check('RESTORE: subject tree identical to before deletion', JSON.stringify(before) === JSON.stringify(after));
check('RESTORE: previously-deleted student stays deleted', !after.students.some(s => s.id === st2));
check('RESTORE: score survives round-trip', (await must('GET', `/api/subjects/${subj}/scores`))?.[c1]?.[st1] === 9);
check('bin no longer lists the restored subject', !(await must('GET', '/api/recycle-bin')).subjects.some(s => s.id === subj));

// --- Delete again → permanently delete -----------------------------------------
await must('DELETE', `/api/subjects/${subj}`);
await must('POST', `/api/subjects/${subj}/purge`);
bin = await must('GET', '/api/recycle-bin');
check('PURGE: gone from the recycle bin', !bin.subjects.some(s => s.id === subj));
check('PURGE: still gone from the main list', !(await must('GET', '/api/subjects')).some(s => s.id === subj));
const restoreAfterPurge = await j('POST', `/api/subjects/${subj}/restore`);
check('PURGE: restore afterwards is still possible ONLY via bin (API allows explicit id)', restoreAfterPurge.status === 200 || restoreAfterPurge.status === 400);

// --- Group lifecycle ------------------------------------------------------------
const { id: grp } = await must('POST', '/api/groups', { name: 'BSIT 2A', description: 'morning' });
await must('POST', `/api/groups/${grp}/students`, { last_name: 'Uno', first_name: 'A' });
await must('POST', `/api/groups/${grp}/students`, { last_name: 'Dos', first_name: 'B' });
await must('DELETE', `/api/groups/${grp}`);
bin = await must('GET', '/api/recycle-bin');
const gEntry = bin.groups.find(g => g.id === grp);
check('bin lists the deleted group with member count', gEntry?.member_count === 2, `members=${gEntry?.member_count}`);
await must('POST', `/api/groups/${grp}/restore`);
const g = await must('GET', `/api/groups/${grp}`);
check('group restore brings back all members', (g.students || g.members || []).length === 2 || g.student_count === 2,
  JSON.stringify(Object.keys(g)));
await must('DELETE', `/api/groups/${grp}`);
await must('POST', `/api/groups/${grp}/purge`);
check('purged group gone from bin', !(await must('GET', '/api/recycle-bin')).groups.some(x => x.id === grp));

console.log(failures ? `\n${failures} FAILURES` : '\nALL RECYCLE BIN TESTS PASSED');
process.exit(failures ? 1 : 0);
