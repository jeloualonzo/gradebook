/**
 * Unit tests for the PURE class-statistics module (src/lib/classStats.js).
 * Run: node scripts/test-class-stats.mjs   (exits non-zero on any failure)
 *
 * Pins the period-closing semantics (ROADMAP Phase 3a): what "missing"
 * means (blanks in ACTIVE columns only), what fill-blanks touches, the
 * footer's column math, and the failing/rank view derivations.
 */
import {
  activeColumnIds,
  missingCounts,
  columnStats,
  blankEntries,
  belowThreshold,
  rankOrder,
} from '../src/lib/classStats.js';

let failures = 0;
const t = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const cols = [{ columnId: 'c1' }, { columnId: 'c2' }, { columnId: 'c3' }];
const students = ['s1', 's2', 's3', 's4'];
// c1: everyone but s3 · c2: only s1 (string value, like the API sends) · c3: untouched
const scores = {
  c1: { s1: 8, s2: 10, s4: 6 },
  c2: { s1: '7.5' },
  c3: {},
};

// ---- active columns / missing ------------------------------------------------
{
  const active = activeColumnIds(cols, scores);
  t('active: a column with any value is active; an untouched one is not',
    active.has('c1') && active.has('c2') && !active.has('c3'));

  const missing = missingCounts(cols, students, scores);
  t('missing: counts blanks in ACTIVE columns only (c3 never counts)',
    missing.get('s1') === 0 && missing.get('s2') === 1 && missing.get('s3') === 2 && missing.get('s4') === 1);

  t('missing: empty grid → all zeros, nothing active',
    activeColumnIds(cols, {}).size === 0 && missingCounts(cols, students, {}).get('s1') === 0);
}

// ---- column stats ---------------------------------------------------------------
{
  const s = columnStats('c1', students, scores);
  t('stats: avg/high/low over entered values', s.avg === 8 && s.high === 10 && s.low === 6);
  t('stats: entered vs missing use the roster denominator', s.entered === 3 && s.missing === 1);
  t('stats: odd-count median is the middle value', s.median === 8);
  const even = columnStats('c1', ['s1', 's2'], scores);
  t('stats: even-count median averages the middle pair', even.median === 9);
  const empty = columnStats('c3', students, scores);
  t('stats: an untouched column has null stats and full missing',
    empty.avg === null && empty.median === null && empty.missing === 4 && empty.entered === 0);
}

// ---- fill blanks -----------------------------------------------------------------
{
  const scoped = blankEntries(cols, students, scores, { onlyActive: true });
  const keys = scoped.map(e => `${e.column_id}:${e.student_id}`).sort().join(' ');
  t('fill: active-only scope skips untouched columns entirely',
    scoped.every(e => e.value === 0) && !scoped.some(e => e.column_id === 'c3'));
  t('fill: the blanks are exactly the missing cells (c1:s3 + c2:s2,s3,s4)',
    keys === 'c1:s3 c2:s2 c2:s3 c2:s4');
  const single = blankEntries([{ columnId: 'c3' }], students, scores, { onlyActive: false });
  t('fill: an explicitly chosen column fills all its blanks regardless of activity',
    single.length === 4 && single.every(e => e.column_id === 'c3'));
}

// ---- views ------------------------------------------------------------------------
{
  const roster = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }];
  const grades = { s1: 88.4, s2: 74.99, s3: null, s4: 75 };
  const failing = belowThreshold(roster, grades, 75);
  t('view: below-75 uses cents (74.99 fails, 75.00 passes, null excluded)',
    failing.length === 1 && failing[0].id === 's2');
  const asc = rankOrder(roster, grades, 'asc');
  t('view: rank asc puts lowest first and null grades last',
    asc.map(s => s.id).join(',') === 's2,s4,s1,s3');
  const desc = rankOrder(roster, grades, 'desc');
  t('view: rank desc puts highest first, nulls still last',
    desc.map(s => s.id).join(',') === 's1,s4,s2,s3');
  const tied = rankOrder([{ id: 'a' }, { id: 'b' }], { a: 80, b: 80 }, 'asc');
  t('view: ties keep the canonical (alphabetical) order', tied.map(s => s.id).join(',') === 'a,b');
}

// ---- term sequencing (rollover wizard, Phase 3b) --------------------------------
{
  const { nextTerm } = await import('../src/lib/term.js');
  const a = nextTerm('2026-2027', '1st');
  t('term: 1st rolls to 2nd, same school year', a.school_year === '2026-2027' && a.semester === '2nd');
  const b = nextTerm('2026-2027', '2nd');
  t('term: 2nd rolls to 1st, next school year', b.school_year === '2027-2028' && b.semester === '1st');
  const c = nextTerm('2026-2027', 'Summer');
  t('term: Summer rolls to 1st, next school year', c.school_year === '2027-2028' && c.semester === '1st');
  t('term: unparseable school year passes through unchanged', nextTerm('AY 26', '2nd').school_year === 'AY 26');
}

// ---- student focus model (Phase 3b) -----------------------------------------------
{
  const { buildStudentFocus, attendanceLetter } = await import('../src/lib/studentFocus.js');
  const subject = { prelim_weight: 100, midterm_weight: 0, final_weight: 0 };
  const periods = [{
    id: 'p1', type: 'PRELIM',
    attendanceConfig: { present_score: 10, late_score: 8, absent_score: 0 },
    assessments: [
      { id: 'att', name: 'Attendance', is_exam: 0, weight_percent: 50, columns: [
        { id: 'a1', date: '2026-07-08', max_score: 10 },
      ] },
      { id: 'qz', name: 'Quiz', is_exam: 0, weight_percent: 50, columns: [
        { id: 'q1', date: '2026-07-09', max_score: 10 },
        { id: 'q2', date: '2026-07-10', max_score: 10 },
      ] },
    ],
  }];
  const fScores = { a1: { s1: 8, s2: 10 }, q1: { s1: 6, s2: 9 }, q2: { s2: 7 } }; // s1 missing q2
  const model = buildStudentFocus({ student: { id: 's1' }, subject, periods, scores: fScores });

  t('focus: attendance letters map through the period config (8 = Late)',
    model.periods[0].assessments[0].entries[0].letter === 'L');
  t('focus: letters only on the Attendance assessment',
    model.periods[0].assessments[1].entries[0].letter === null);
  t('focus: missing list names the active blank (Quiz, q2)',
    model.missingCount === 1 && model.missing[0].assessment === 'Quiz' && model.missing[0].date === '2026-07-10');
  t('focus: entered counts per assessment', model.periods[0].assessments[1].entered === 1);
  t('focus: period grade matches the calculator (att 80% ×50 + quiz 60% ×50 = 70)',
    Math.round(model.periods[0].grade) === 70 && Math.round(model.finalGrade) === 70);
  t('focus: attendanceLetter is cents-safe and null off-scale',
    attendanceLetter('10', { present_score: 10, late_score: 8, absent_score: 0 }) === 'P' &&
    attendanceLetter(7, { present_score: 10, late_score: 8, absent_score: 0 }) === null);
}

console.log(failures === 0 ? '\nALL CLASS STATS TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
