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

console.log(failures === 0 ? '\nALL CLASS STATS TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
