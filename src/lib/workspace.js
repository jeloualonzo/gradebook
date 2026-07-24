/**
 * Workspace Assessments (v1.9.0) — PURE module: no React, no DB, no I/O.
 * Unit-tested in scripts/test-workspace.mjs; used by the grid, the workspace
 * pages, the grade calculator, and the server-side exports alike.
 *
 * The architecture in one sentence: a workspace assessment is an ORDINARY
 * assessment whose detail columns are hidden from the grid and managed in a
 * dedicated workspace, while the grid shows one COMPUTED column. Details are
 * plain assessment_columns + scores — sync, autosave, undo, and conflict
 * review all apply unchanged.
 *
 * Two spans:
 *   'period' — sessions live in the owning period (e.g. Oral Participation:
 *              each recitation session is a detail column).
 *   'term'   — one master record projected into EVERY period band; details
 *              are three per-period bucket columns (period_type tag). A
 *              student's score counts in the period where it was earned —
 *              no copying, ever.
 *
 * Statuses are DERIVED, never stored (the same principle as the missing
 * rule): 'completed' | 'expected' | 'not_applicable'. N/A cells contribute
 * null to grades — computePeriodGrade's per-student renormalization does
 * the rest.
 *
 * Aggregation never looks at another student's scores: the maximum comes
 * from configuration (agg_max) or the sessions' own max scores — a
 * class-best-based maximum is structurally impossible here.
 */

export const isWorkspace = (a) => a?.behavior === 'workspace';

/** Teacher-facing status labels (owner-specified terminology). */
export const STATUS_LABELS = {
  completed: 'Completed',
  expected: 'Expected',
  not_applicable: 'N/A',
};

/**
 * Aggregation methods, in teacher language. `needsMax` gates the target
 * input in the UI; internally agg_max also scales 'average'.
 */
export const AGG_METHODS = [
  {
    id: 'sum',
    label: 'Total points',
    hint: 'Earned over possible, across the sessions the student has scores in.',
    needsMax: false,
  },
  {
    id: 'sum_capped',
    label: 'Point bank',
    hint: 'Scores add up toward a target total; the computed score never exceeds it.',
    needsMax: true,
  },
  {
    id: 'average',
    label: 'Average of sessions',
    hint: 'Each session counts equally; blank sessions count as zero once scoring starts.',
    needsMax: false,
  },
];

export const aggMethodLabel = (id) => AGG_METHODS.find(m => m.id === id)?.label || id;

/**
 * Creation templates — each provides a sensible default the instructor can
 * change (nothing is hardcoded to a template; the config lives on the
 * assessment row). Future workspace workflows = new entries here.
 */
export const WORKSPACE_TEMPLATES = [
  {
    id: 'oral',
    name: 'Oral Participation',
    span: 'period',
    agg_method: 'sum_capped',
    suggestedMax: 30,
    description: 'Recitation sessions inside a workspace; points add up toward a target total.',
  },
  {
    id: 'reporting',
    name: 'Reporting',
    span: 'term',
    agg_method: 'sum',
    suggestedMax: 50,
    description: 'One score per student — counted in whichever grading period they present. Defense, demonstration, speech, and performance tasks fit this shape.',
  },
  {
    id: 'custom',
    name: 'Custom workspace',
    span: 'period',
    agg_method: 'sum',
    suggestedMax: null,
    description: 'Start from a blank workspace and pick the computation yourself.',
  },
];

const val = (raw) => (raw !== undefined && raw !== null && raw !== '' ? parseFloat(raw) : null);

/** True when ANY student has ANY score in the assessment's columns. */
function hasAnyScore(columns, scores) {
  for (const col of columns || []) {
    const colScores = scores?.[col.id];
    if (!colScores) continue;
    for (const v of Object.values(colScores)) {
      if (v !== undefined && v !== null && v !== '') return true;
    }
  }
  return false;
}

/**
 * One student's computed result over an assessment's (already period-scoped)
 * detail columns → { earned, max } or null (no contribution: the category
 * renormalizes away for this student, exactly like an unscored category).
 */
export function workspaceAggregate(assessment, scores, studentId) {
  const columns = assessment?.columns || [];
  if (columns.length === 0) return null;
  const method = assessment.agg_method || 'sum';
  const target = parseFloat(assessment.agg_max);

  if (method === 'sum_capped' && target > 0) {
    // Point bank: sessions accumulate toward the configured target. Once
    // scoring has started anywhere, an empty bank is honestly 0 — a student
    // who has not recited has earned nothing YET (never renormalized away,
    // or the least participating student would escape the weight).
    if (!hasAnyScore(columns, scores)) return null;
    let sum = 0;
    for (const col of columns) {
      const v = val(scores?.[col.id]?.[studentId]);
      if (v !== null) sum += v;
    }
    return { earned: Math.min(sum, target), max: target };
  }

  if (method === 'average') {
    // Consistency: each session counts equally as a percentage of its own
    // max; blanks count as zero once scoring has started. Scaled to the
    // configured target (default 100 = a plain percentage).
    if (!hasAnyScore(columns, scores)) return null;
    const M = target > 0 ? target : 100;
    let pctSum = 0;
    let n = 0;
    for (const col of columns) {
      const max = parseFloat(col.max_score) || 0;
      if (max <= 0) continue;
      const v = val(scores?.[col.id]?.[studentId]);
      pctSum += (v ?? 0) / max;
      n += 1;
    }
    if (n === 0) return null;
    return { earned: (pctSum / n) * M, max: M };
  }

  // 'sum' — earned over possible across the student's SCORED columns:
  // byte-identical to the classic category math in computePeriodGrade.
  let earned = 0;
  let max = 0;
  for (const col of columns) {
    const m = parseFloat(col.max_score) || 0;
    const v = val(scores?.[col.id]?.[studentId]);
    if (m > 0 && v !== null) {
      earned += v;
      max += m;
    }
  }
  return max > 0 ? { earned, max } : null;
}

/**
 * A student's status for one grading period, from the RAW assessment (all
 * detail columns, unfiltered). Teacher terminology (owner-specified):
 *   'completed'      — has a score counting in this period
 *   'not_applicable' — scored in a DIFFERENT period (term-span only)
 *   'expected'       — no score anywhere yet (still owes the work)
 */
export function workspaceStatus(assessment, scores, studentId, periodType) {
  // Projected copies carry period-FILTERED columns; N/A-vs-Expected needs
  // the whole picture, which the projector preserves as `allColumns`.
  const columns = assessment?.allColumns || assessment?.columns || [];
  const scoredIn = (col) => val(scores?.[col.id]?.[studentId]) !== null;
  if (assessment?.span === 'term') {
    let here = false;
    let elsewhere = false;
    for (const col of columns) {
      if (!scoredIn(col)) continue;
      if (col.period_type === periodType) here = true;
      else elsewhere = true;
    }
    if (here) return 'completed';
    return elsewhere ? 'not_applicable' : 'expected';
  }
  return columns.some(scoredIn) ? 'completed' : 'expected';
}

/**
 * Project raw periods into the DISPLAY/GRADING view — a pure view transform,
 * never an API or database shape (rollover, drag-reorder, and the weights
 * data keep reading truthful raw rows):
 *   · every workspace assessment's columns are filtered to the band being
 *     rendered (term-span: only that period's bucket; period-span: all its
 *     sessions in its own band);
 *   · term-span assessments additionally appear in every OTHER period band
 *     (marked `projected: true`, placed before the exam), so the grid shows
 *     the computed column wherever a score could count.
 * computePeriodGrade then needs no signature change: each band's copy
 * carries exactly the columns that count in that band.
 */
export function projectPeriods(periods) {
  const termSpanning = [];
  for (const p of periods || []) {
    for (const a of p.assessments || []) {
      if (isWorkspace(a) && a.span === 'term') termSpanning.push(a);
    }
  }
  return (periods || []).map(p => {
    const assessments = [];
    for (const a of p.assessments || []) {
      if (isWorkspace(a) && a.span === 'term') {
        // allColumns keeps the unfiltered buckets so status derivation can
        // tell N/A (scored elsewhere) from Expected (scored nowhere).
        assessments.push({ ...a, allColumns: a.columns || [], columns: (a.columns || []).filter(c => c.period_type === p.type) });
      } else {
        assessments.push(a);
      }
    }
    // Foreign term-span assessments join this band before the exam.
    for (const a of termSpanning) {
      if ((p.assessments || []).some(x => x.id === a.id)) continue;
      const copy = {
        ...a,
        projected: true,
        allColumns: a.columns || [],
        columns: (a.columns || []).filter(c => c.period_type === p.type),
      };
      const examIdx = assessments.findIndex(x => x.is_exam);
      if (examIdx === -1) assessments.push(copy);
      else assessments.splice(examIdx, 0, copy);
    }
    return { ...p, assessments };
  });
}

/**
 * Whole-assessment management summary (workspace header + grid column cue),
 * from the RAW assessment. avg/high/low are computed EARNED values over the
 * students who have any score — display alongside the target/possible max.
 */
export function workspaceSummary(assessment, students, scores) {
  const list = students || [];
  let completed = 0;
  const expectedStudents = [];
  const earnedValues = [];
  for (const s of list) {
    const sid = String(s.id);
    const agg = workspaceAggregate(assessment, scores, sid);
    const scored = (assessment?.columns || []).some(c => val(scores?.[c.id]?.[sid]) !== null);
    if (scored) {
      completed += 1;
      if (agg) earnedValues.push(agg.earned);
    } else {
      expectedStudents.push(s);
    }
  }
  const avg = earnedValues.length ? earnedValues.reduce((a, b) => a + b, 0) / earnedValues.length : null;
  return {
    total: list.length,
    completed,
    expected: expectedStudents.length,
    expectedStudents,
    avg,
    high: earnedValues.length ? Math.max(...earnedValues) : null,
    low: earnedValues.length ? Math.min(...earnedValues) : null,
  };
}
