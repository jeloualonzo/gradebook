/**
 * Workflow features e2e — group-from-subject, move-column-to-subject,
 * attendance-source columns.
 *
 * Usage: boot one instance on port 3171 with a fresh GRADEBOOK_DATA_DIR,
 * then: node scripts/test-workflows.mjs
 */
const P = 3171;
const j = async (m, p, b) => {
  const res = await fetch(`http://127.0.0.1:${P}${p}`, {
    method: m, headers: { 'Content-Type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const must = async (m, p, b) => { const r = await j(m, p, b); if (r.status >= 400) throw new Error(`${m} ${p} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); if (!ok) failures++; };
const mkSubject = async (name) => {
  const { id } = await must('POST', '/api/subjects', { name, section: 'X', school_year: '2026-2027', semester: '1st' });
  await must('POST', `/api/subjects/${id}/init`, { periods: ['PRELIM','MIDTERM','FINAL'].map(type => ({ type, assessments: [
    { name: 'Attendance', is_exam: 0, weight_percent: 30 }, { name: 'Quiz', is_exam: 0, weight_percent: 30 }, { name: 'Exam', is_exam: 1, weight_percent: 40 },
  ] })) });
  return id;
};
const scoresOf = async (subj) => must('GET', `/api/subjects/${subj}/scores`);
const cell = (sc, c, s) => sc?.[c]?.[s];

// ============ Feature 1: group from subject ============
const A = await mkSubject('Prog 1');
const add = (subj, l, f, m = '', suf = '') => must('POST', `/api/subjects/${subj}/students`, { last_name: l, first_name: f, middle_name: m, suffix: suf });
const a1 = (await add(A, 'Dela Cruz', 'Juan', 'S', 'Jr.')).id;
const a2 = (await add(A, 'Garcia', 'Maria', 'R')).id;
const a3 = (await add(A, 'Santos', 'Pedro')).id;

const grpRes = await must('POST', `/api/subjects/${A}/create-group`, { name: 'Prog 1 Roster' });
check('F1: group created with all 3 students', grpRes.added === 3 && !!grpRes.group_id);
const members = await must('GET', `/api/groups/${grpRes.group_id}/students`);
check('F1: members carry full identity incl. suffix', members.some(m => m.last_name === 'Dela Cruz' && m.suffix === 'Jr.'));
check('F1: subject roster untouched', (await must('GET', `/api/subjects/${A}/students`)).length === 3);
const empty = await mkSubject('Empty');
check('F1: empty subject refuses politely', (await j('POST', `/api/subjects/${empty}/create-group`, { name: 'X' })).status === 400);

// ============ Feature 2: move a column to another subject ============
const B = await mkSubject('Prog 2'); // shares 2 of 3 students
await add(B, 'Dela Cruz', 'Juan', 'S', 'Jr.');
await add(B, 'Garcia', 'Maria', 'R');
const bStudents = await must('GET', `/api/subjects/${B}/students`);

const periodsA = await must('GET', `/api/subjects/${A}/periods`);
const quizA = periodsA[0].assessments.find(x => x.name === 'Quiz');
const examA = periodsA[0].assessments.find(x => x.is_exam);
const colId = (await must('POST', `/api/assessments/${quizA.id}/columns`, { date: '2026-07-15', max_score: 20 })).id;
await must('PUT', `/api/scores/${colId}/${a1}`, { value: 18 });
await must('PUT', `/api/scores/${colId}/${a2}`, { value: 15 });
await must('PUT', `/api/scores/${colId}/${a3}`, { value: 12 }); // Pedro is NOT in B

// Dry run: into MIDTERM of B, category "Activity" (doesn't exist yet)
const dry = await must('POST', `/api/columns/${colId}/move`, { subject_id: B, period_type: 'MIDTERM', assessment_name: 'Activity', dry_run: true });
check('F2: preview matches by identity (2 of 3)', dry.matched === 2 && dry.unmatched.length === 1 && dry.will_create_assessment === true,
  JSON.stringify(dry));
check('F2: preview names the unmatched student', dry.unmatched[0]?.last_name === 'Santos');
check('F2: dry run changed nothing', (await must('GET', `/api/subjects/${A}/periods`))[0].assessments.find(x => x.name === 'Quiz').columns.length === 1);

// Real move WITH create_missing_students
const moved = await must('POST', `/api/columns/${colId}/move`, { subject_id: B, period_type: 'MIDTERM', assessment_name: 'Activity', create_missing_students: true });
check('F2: move reports 3 matched (Pedro created)', moved.matched === 3 && moved.created_students === 1 && moved.created_assessment === 'Activity');
const periodsA2 = await must('GET', `/api/subjects/${A}/periods`);
check('F2: source subject no longer has the column', periodsA2[0].assessments.find(x => x.name === 'Quiz').columns.length === 0);
const periodsB = await must('GET', `/api/subjects/${B}/periods`);
const midtermB = periodsB.find(p => p.type === 'MIDTERM');
const activity = midtermB.assessments.find(x => x.name === 'Activity');
check('F2: destination category created (non-exam), column carried date+max',
  !!activity && activity.is_exam === 0 && activity.columns.length === 1 && activity.columns[0].date === '2026-07-15' && activity.columns[0].max_score === 20);
check('F2: exam still last in destination period', midtermB.assessments[midtermB.assessments.length - 1].is_exam === 1);
const bStudents2 = await must('GET', `/api/subjects/${B}/students`);
const pedroB = bStudents2.find(s => s.last_name === 'Santos');
check('F2: Pedro added to destination', !!pedroB && bStudents2.length === 3);
const bScores = await scoresOf(B);
const juanB = bStudents2.find(s => s.last_name === 'Dela Cruz');
const mariaB = bStudents2.find(s => s.last_name === 'Garcia');
check('F2: scores followed identity (18/15/12)',
  cell(bScores, colId, juanB.id) === 18 && cell(bScores, colId, mariaB.id) === 15 && cell(bScores, colId, pedroB.id) === 12);
check('F2: source subject has no scores left on that column', !Object.keys(await scoresOf(A)).includes(colId));
// Exam guard
const examColId = examA.columns[0].id;
check('F2: exam columns refuse to move', (await j('POST', `/api/columns/${examColId}/move`, { subject_id: B, period_type: 'MIDTERM', assessment_name: 'Quiz', dry_run: true })).status === 400);

// ============ Feature 3: attendance source ============
const quizB = periodsB.find(p => p.type === 'PRELIM').assessments.find(x => x.name === 'Quiz');
const srcCol = (await must('POST', `/api/assessments/${quizB.id}/columns`, { date: '2026-07-20', max_score: 10 })).id;
await must('PUT', `/api/columns/${srcCol}`, { attendance_source: 1 });
// Pre-set Maria's attendance for that date to LATE (8) — must NOT be overwritten.
const attB = periodsB.find(p => p.type === 'PRELIM').assessments.find(x => x.name === 'Attendance');
const attCol = (await must('POST', `/api/assessments/${attB.id}/columns`, { date: '2026-07-20', max_score: 10 })).id;
await must('PUT', `/api/scores/${attCol}/${mariaB.id}`, { value: 8 });

// Juan gets a quiz score → auto-Present. Pedro stays blank → untouched.
await must('PUT', `/api/scores/${srcCol}/${juanB.id}`, { value: 9 });
await must('PUT', `/api/scores/${srcCol}/${mariaB.id}`, { value: 7 });
const after = await scoresOf(B);
const periodsB3 = await must('GET', `/api/subjects/${B}/periods`);
const attCols = periodsB3.find(p => p.type === 'PRELIM').assessments.find(x => x.name === 'Attendance').columns;
check('F3: same-date attendance column REUSED (no duplicate)', attCols.filter(c => c.date === '2026-07-20').length === 1);
check('F3: scored student auto-marked Present (10)', cell(after, attCol, juanB.id) === 10);
check('F3: existing attendance NOT overwritten (Maria stays 8)', cell(after, attCol, mariaB.id) === 8);
check('F3: blank student stays blank (Pedro)', cell(after, attCol, pedroB.id) === undefined);
// Un-flagged column does nothing
await must('PUT', `/api/columns/${srcCol}`, { attendance_source: 0 });
const plainCol = (await must('POST', `/api/assessments/${quizB.id}/columns`, { date: '2026-07-27', max_score: 10 })).id;
await must('PUT', `/api/scores/${plainCol}/${juanB.id}`, { value: 5 });
const attCols2 = (await must('GET', `/api/subjects/${B}/periods`)).find(p => p.type === 'PRELIM').assessments.find(x => x.name === 'Attendance').columns;
check('F3: unmarked columns never create attendance', !attCols2.some(c => c.date === '2026-07-27'));
// Auto-creation of the attendance date when it does not exist yet
await must('PUT', `/api/columns/${plainCol}`, { attendance_source: 1 });
await must('PUT', `/api/scores/${plainCol}/${mariaB.id}`, { value: 6 });
const attCols3 = (await must('GET', `/api/subjects/${B}/periods`)).find(p => p.type === 'PRELIM').assessments.find(x => x.name === 'Attendance').columns;
const created = attCols3.find(c => c.date === '2026-07-27');
check('F3: attendance date auto-created when missing', !!created && created.max_score === 10);
check('F3: and the scorer marked Present in it', cell(await scoresOf(B), created.id, mariaB.id) === 10);

// ============ Feature 4: bulk writes carry attendance parity (Phase 2b) ============
// A PASTED score on a counts-as-attendance column must mark Present exactly
// like a typed one — same hook, same blank-only rule, applications returned
// so the grid can mirror them live.
const bulkCol = (await must('POST', `/api/assessments/${quizB.id}/columns`, { date: '2026-08-01', max_score: 10 })).id;
await must('PUT', `/api/columns/${bulkCol}`, { attendance_source: 1 });
// Pre-mark Maria LATE for that date — bulk must not overwrite her.
const attB4 = (await must('GET', `/api/subjects/${B}/periods`)).find(p => p.type === 'PRELIM')
  .assessments.find(x => x.name === 'Attendance');
const attCol4 = (await must('POST', `/api/assessments/${attB4.id}/columns`, { date: '2026-08-01', max_score: 10, dedupe_by_date: true })).id;
await must('PUT', `/api/scores/${attCol4}/${mariaB.id}`, { value: 8 });

const bulkRes = await must('POST', '/api/scores/bulk', { entries: [
  { column_id: bulkCol, student_id: juanB.id, value: 7 },
  { column_id: bulkCol, student_id: mariaB.id, value: 6 },
  { column_id: bulkCol, student_id: pedroB.id, value: null }, // a cleared cell never marks attendance
] });
check('F4: bulk response reports the attendance applications',
  Array.isArray(bulkRes.attendance) && bulkRes.attendance.length === 1 &&
  bulkRes.attendance[0].applied === true && bulkRes.attendance[0].student_id === juanB.id,
  JSON.stringify(bulkRes.attendance));
const after4 = await scoresOf(B);
check('F4: pasted score auto-marked Juan Present (10)', cell(after4, attCol4, juanB.id) === 10);
check('F4: existing attendance NOT overwritten (Maria stays 8)', cell(after4, attCol4, mariaB.id) === 8);
check('F4: cleared cell leaves attendance blank (Pedro)', cell(after4, attCol4, pedroB.id) === undefined);
// Idempotent re-paste: guards skip identical values; no duplicate marks.
const bulkRes2 = await must('POST', '/api/scores/bulk', { entries: [
  { column_id: bulkCol, student_id: juanB.id, value: 7 },
] });
check('F4: re-pasting the same value applies no new attendance', (bulkRes2.attendance || []).length === 0);

// ============ Feature 5: semester rollover (Phase 3b) ============
// Structure always · roster by choice · dated columns and scores NEVER.
const R = await mkSubject('Rollover Src');
const rs = [];
for (const [l, f] of [['Reyes', 'Ana'], ['Santos', 'Ben']]) {
  rs.push((await must('POST', `/api/subjects/${R}/students`, { last_name: l, first_name: f })).id);
}
const rPeriods = await must('GET', `/api/subjects/${R}/periods`);
const rPrelim = rPeriods.find(p => p.type === 'PRELIM');
const rQuiz = rPrelim.assessments.find(a => a.name === 'Quiz');
await must('PUT', `/api/assessments/${rQuiz.id}`, { weight_percent: 40 });
await must('PUT', `/api/attendance/${rPrelim.id}`, { present_score: 12, late_score: 9, absent_score: 1 });
const rCol = (await must('POST', `/api/assessments/${rQuiz.id}/columns`, { date: '2026-07-15', max_score: 20 })).id;
await must('PUT', `/api/scores/${rCol}/${rs[0]}`, { value: 15 });

const roll = await must('POST', `/api/subjects/${R}/rollover`, {
  name: 'Rollover Src', subject_code: 'RS 101', section: 'BSIS 4A',
  school_year: '2027-2028', semester: '1st', roster: 'copy',
});
const newSubj = await must('GET', `/api/subjects/${roll.id}`);
check('F5: new term carries identity + term fields',
  newSubj.subject_code === 'RS 101' && newSubj.section === 'BSIS 4A' &&
  newSubj.school_year === '2027-2028' && newSubj.semester === '1st');
const nPeriods = await must('GET', `/api/subjects/${roll.id}/periods`);
const nPrelim = nPeriods.find(p => p.type === 'PRELIM');
const nQuiz = nPrelim.assessments.find(a => a.name === 'Quiz');
const nExam = nPrelim.assessments.find(a => a.is_exam);
check('F5: structure carries — 3 periods, edited weight, attendance config',
  nPeriods.length === 3 && String(nQuiz.weight_percent) === '40' &&
  nPrelim.attendanceConfig?.present_score === 12 && nPrelim.attendanceConfig?.late_score === 9);
check('F5: dated columns do NOT travel; the exam keeps its one undated column',
  nQuiz.columns.length === 0 && nExam.columns.length === 1 && nExam.columns[0].date === null);
const nStudents = await must('GET', `/api/subjects/${roll.id}/students`);
check('F5: roster copied by name with FRESH ids (no scores can follow)',
  nStudents.length === 2 && nStudents.some(s => s.last_name === 'Reyes') && !nStudents.some(s => rs.includes(s.id)));
check('F5: scores never travel', Object.keys(await scoresOf(roll.id)).length === 0);

const grp = await must('POST', '/api/groups', { name: 'Rollover Grp' });
await must('POST', `/api/groups/${grp.id}/students`, { last_name: 'Tan', first_name: 'Cia' });
const roll2 = await must('POST', `/api/subjects/${R}/rollover`, {
  name: 'Rollover Grp Term', section: 'X', school_year: '2027-2028', semester: '1st',
  roster: 'group', group_id: grp.id,
});
check('F5: group roster imports the group members',
  (await must('GET', `/api/subjects/${roll2.id}/students`)).some(s => s.last_name === 'Tan'));
const roll3 = await must('POST', `/api/subjects/${R}/rollover`, {
  name: 'Empty Term', section: 'X', school_year: '2027-2028', semester: '2nd', roster: 'empty',
});
check('F5: the empty option starts with zero students',
  (await must('GET', `/api/subjects/${roll3.id}/students`)).length === 0);

console.log(failures ? `\n${failures} FAILURES` : '\nALL WORKFLOW TESTS PASSED');
process.exit(failures ? 1 : 0);
