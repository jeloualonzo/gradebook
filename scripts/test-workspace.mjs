/**
 * Unit tests for the Workspace Assessment pure model (v1.9.0):
 *   · src/lib/workspace.js   (aggregation, statuses, projection, summary)
 *   · its integration with computePeriodGrade (per-student renormalization)
 * Run: node scripts/test-workspace.mjs   (exits non-zero on any failure)
 */
import {
  isWorkspace,
  workspaceAggregate,
  workspaceStatus,
  projectPeriods,
  workspaceSummary,
  WORKSPACE_TEMPLATES,
  AGG_METHODS,
} from '../src/lib/workspace.js';
import { computePeriodGrade } from '../src/lib/gradeCalculator.js';

let failures = 0;
const t = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};
const close = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

// ---- fixtures -----------------------------------------------------------------
// Oral Participation (period-span, point bank of 30): three sessions.
const oral = (over = {}) => ({
  id: 'oral', name: 'Oral Participation', is_exam: 0, weight_percent: 10,
  behavior: 'workspace', span: 'period', agg_method: 'sum_capped', agg_max: 30,
  columns: [
    { id: 'os1', max_score: 10, date: '2026-08-01', label: '' },
    { id: 'os2', max_score: 10, date: '2026-08-08', label: '' },
    { id: 'os3', max_score: 20, date: '2026-08-15', label: '' },
  ],
  ...over,
});
// Reporting (term-span, one bucket per period, max 50).
const reporting = (over = {}) => ({
  id: 'rep', name: 'Reporting', is_exam: 0, weight_percent: 20,
  behavior: 'workspace', span: 'term', agg_method: 'sum', agg_max: null,
  columns: [
    { id: 'rp', max_score: 50, date: null, period_type: 'PRELIM', label: '' },
    { id: 'rm', max_score: 50, date: null, period_type: 'MIDTERM', label: '' },
    { id: 'rf', max_score: 50, date: null, period_type: 'FINAL', label: '' },
  ],
  ...over,
});

// ---- aggregation: point bank ----------------------------------------------------
{
  const a = oral();
  const scores = { os1: { s1: 8, s2: 4 }, os2: { s1: 9 }, os3: { s1: 18 } };
  t('bank: sessions accumulate toward the target (8+9+18 → capped at 30)',
    close(workspaceAggregate(a, scores, 's1').earned, 30) && workspaceAggregate(a, scores, 's1').max === 30);
  t('bank: below the cap stays exact (4/30)', close(workspaceAggregate(a, scores, 's2').earned, 4));
  t('bank: once scoring started, an empty bank is honestly 0 — never renormalized away',
    close(workspaceAggregate(a, scores, 's3').earned, 0) && workspaceAggregate(a, scores, 's3').max === 30);
  t('bank: before ANY scoring, nobody is penalized (null)',
    workspaceAggregate(a, {}, 's1') === null);
  t('bank: no sessions yet → null', workspaceAggregate(oral({ columns: [] }), {}, 's1') === null);
  t('bank: the maximum is the CONFIGURED target — a perfect class cannot raise it',
    workspaceAggregate(a, { os1: { s1: 10 }, os2: { s1: 10 }, os3: { s1: 20 } }, 's1').max === 30);
  t('bank: without a target it degrades to plain totals (defensive)',
    close(workspaceAggregate(oral({ agg_max: null }), scores, 's2').earned, 4) &&
    workspaceAggregate(oral({ agg_max: null }), scores, 's2').max === 10);
}

// ---- aggregation: average of sessions -------------------------------------------
{
  const a = oral({ agg_method: 'average', agg_max: 30 });
  const scores = { os1: { s1: 10, s2: 5 }, os2: { s1: 10 }, os3: { s1: 20 } };
  t('average: perfect sessions → the full target', close(workspaceAggregate(a, scores, 's1').earned, 30));
  // s2: 5/10, blank/10 (=0), blank/20 (=0) → mean 1/6 of 30 = 5
  t('average: blanks count as zero once scoring starts',
    close(workspaceAggregate(a, scores, 's2').earned, 5));
  t('average: default scale is 100 when no target set',
    workspaceAggregate(oral({ agg_method: 'average', agg_max: null }), scores, 's1').max === 100);
  t('average: before any scoring → null', workspaceAggregate(a, {}, 's1') === null);
}

// ---- aggregation: plain sum (classic math) --------------------------------------
{
  const a = oral({ agg_method: 'sum', agg_max: null });
  const scores = { os1: { s1: 8 }, os3: { s1: 15 } };
  const agg = workspaceAggregate(a, scores, 's1');
  t('sum: earned over possible across SCORED sessions only (8+15 over 10+20)',
    close(agg.earned, 23) && agg.max === 30);
  t('sum: unscored student → null (classic renormalization)',
    workspaceAggregate(a, scores, 's2') === null);
}

// ---- statuses (owner terminology: Completed / Expected / N/A) --------------------
{
  const r = reporting();
  const scores = { rm: { s1: 45 } }; // s1 reported in MIDTERM
  t('status: scored in this period → completed', workspaceStatus(r, scores, 's1', 'MIDTERM') === 'completed');
  t('status: scored in ANOTHER period → not_applicable', workspaceStatus(r, scores, 's1', 'PRELIM') === 'not_applicable');
  t('status: scored nowhere yet → expected', workspaceStatus(r, scores, 's2', 'PRELIM') === 'expected');
  const a = oral();
  t('status: session-span with any score → completed', workspaceStatus(a, { os1: { s1: 5 } }, 's1', 'PRELIM') === 'completed');
  t('status: session-span never reports N/A', workspaceStatus(a, { os1: { s1: 5 } }, 's2', 'PRELIM') === 'expected');
  // Status must work from a PROJECTED copy too (filtered columns): the
  // projector preserves allColumns exactly for this.
  const projected = projectPeriods([
    { id: 'p1', type: 'PRELIM', assessments: [r] },
    { id: 'p2', type: 'MIDTERM', assessments: [] },
  ]);
  const prelimCopy = projected[0].assessments[0];
  t('status: a projected copy still tells N/A from Expected (via allColumns)',
    workspaceStatus(prelimCopy, scores, 's1', 'PRELIM') === 'not_applicable' &&
    workspaceStatus(prelimCopy, scores, 's2', 'PRELIM') === 'expected');
}

// ---- projection (pure view transform) --------------------------------------------
{
  const periods = [
    { id: 'p1', type: 'PRELIM', assessments: [
      { id: 'q', name: 'Quiz', is_exam: 0, behavior: 'columns', columns: [{ id: 'q1', max_score: 10 }] },
      reporting(),
      { id: 'ex1', name: 'Exam', is_exam: 1, behavior: 'columns', columns: [{ id: 'e1', max_score: 100 }] },
    ] },
    { id: 'p2', type: 'MIDTERM', assessments: [
      { id: 'ex2', name: 'Exam', is_exam: 1, behavior: 'columns', columns: [{ id: 'e2', max_score: 100 }] },
    ] },
  ];
  const proj = projectPeriods(periods);
  const prelimRep = proj[0].assessments.find(a => a.id === 'rep');
  const midRep = proj[1].assessments.find(a => a.id === 'rep');
  t('project: owning band keeps only its own bucket',
    prelimRep.columns.length === 1 && prelimRep.columns[0].period_type === 'PRELIM' && !prelimRep.projected);
  t('project: term-span appears in every other band, marked projected',
    !!midRep && midRep.projected === true && midRep.columns.length === 1 && midRep.columns[0].period_type === 'MIDTERM');
  t('project: projected copies land BEFORE the exam',
    proj[1].assessments.findIndex(a => a.id === 'rep') < proj[1].assessments.findIndex(a => a.is_exam));
  t('project: classic assessments pass through untouched',
    proj[0].assessments.find(a => a.id === 'q').columns.length === 1);
  t('project: raw input is never mutated', periods[1].assessments.length === 1);
  t('project: period-span workspaces are NOT projected into other bands',
    projectPeriods([{ id: 'p1', type: 'PRELIM', assessments: [oral()] }, { id: 'p2', type: 'MIDTERM', assessments: [] }])[1].assessments.length === 0);
}

// ---- grade integration (per-student renormalization) ------------------------------
{
  // MIDTERM band: Quiz 40%, projected Reporting 20%, Exam 40%.
  const quiz = { id: 'q', weight_percent: 40, behavior: 'columns', columns: [{ id: 'qc', max_score: 10 }] };
  const exam = { id: 'e', weight_percent: 40, is_exam: 1, behavior: 'columns', columns: [{ id: 'ec', max_score: 100 }] };
  const repMid = { ...reporting(), weight_percent: 20, projected: true, columns: reporting().columns.filter(c => c.period_type === 'MIDTERM') };
  const band = [quiz, repMid, exam];

  // s1 reported in MIDTERM (45/50 = 90%); quiz 8/10 (80%), exam 70/100.
  const scores = { qc: { s1: 8, s2: 8 }, ec: { s1: 70, s2: 70 }, rm: { s1: 45 } };
  const g1 = computePeriodGrade(band, scores, 's1');
  t('grades: completed student — reporting counts in ITS period (80·.4 + 90·.2 + 70·.4 = 78)',
    close(g1, 78));
  // s2 did not report in MIDTERM → category drops, weights renormalize (80·40+70·40)/80.
  const g2 = computePeriodGrade(band, scores, 's2');
  t('grades: N/A or Expected student — category renormalizes away (75)', close(g2, 75));
  // PRELIM band for s1 (reported in MIDTERM): same renormalization there.
  const repPre = { ...reporting(), weight_percent: 20, projected: true, columns: reporting().columns.filter(c => c.period_type === 'PRELIM') };
  const g3 = computePeriodGrade([quiz, repPre, exam], scores, 's1');
  t('grades: the SAME student renormalizes in bands where they did not present', close(g3, 75));

  // Point bank flows through the calculator too: oral 10%, quiz 90%.
  const bank = { ...oral(), weight_percent: 10 };
  const bandOral = [{ ...quiz, weight_percent: 90 }, bank];
  const oralScores = { qc: { s1: 9 }, os1: { s1: 6 }, os2: { s1: 6 }, os3: { s1: 24 } };
  const gOral = computePeriodGrade(bandOral, oralScores, 's1');
  t('grades: point bank caps inside the period grade (90·.9 + 100·.1 = 91)', close(gOral, 91));
  t('workspace: isWorkspace helper', isWorkspace(oral()) && !isWorkspace(quiz));
}

// ---- summary --------------------------------------------------------------------
{
  const r = reporting();
  const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
  const scores = { rp: { s1: 40 }, rm: { s2: 48 } };
  const sum = workspaceSummary(r, students, scores);
  t('summary: completed / expected counts', sum.completed === 2 && sum.expected === 1 && sum.total === 3);
  t('summary: expected students are named', sum.expectedStudents[0].id === 's3');
  t('summary: avg/high/low over computed earned values',
    close(sum.avg, 44) && close(sum.high, 48) && close(sum.low, 40));
  t('summary: empty assessment → nulls, everyone expected',
    workspaceSummary(reporting({ columns: [] }), students, {}).expected === 3 &&
    workspaceSummary(reporting({ columns: [] }), students, {}).avg === null);
}

// ---- registries -------------------------------------------------------------------
{
  t('templates: every template names a valid method',
    WORKSPACE_TEMPLATES.every(tpl => AGG_METHODS.some(m => m.id === tpl.agg_method)));
  t('templates: oral defaults to the point bank, reporting to term-span totals',
    WORKSPACE_TEMPLATES.find(x => x.id === 'oral').agg_method === 'sum_capped' &&
    WORKSPACE_TEMPLATES.find(x => x.id === 'reporting').span === 'term');
}

console.log(failures === 0 ? '\nALL WORKSPACE TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
