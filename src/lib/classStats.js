/**
 * Class statistics & missing-work semantics — PURE. No DOM, no React, no I/O.
 *
 * The period-closing cluster's brain (ROADMAP Phase 3, batch 3a). The one
 * decision that makes "missing" honest lives here:
 *
 *   A column is ACTIVE once ANY student has a value in it. "Missing work"
 *   means blank cells in active columns — the class took it, this student
 *   has nothing. Blanks in untouched columns (tomorrow's quiz) are not
 *   missing anything, and counting them would make every indicator scream
 *   all semester.
 *
 * Grades compare through integer cents (house rule: never raw float
 * comparison) wherever a threshold is involved.
 */
import { toCents } from './gradeCalculator.js';

const hasValue = (v) => v !== undefined && v !== null && v !== '';

/** The set of column ids (from geometry-ordered cols) with at least one entered value. */
export function activeColumnIds(cols, scores) {
  const active = new Set();
  for (const col of cols) {
    const perStudent = scores?.[col.columnId];
    if (!perStudent) continue;
    for (const sid in perStudent) {
      if (hasValue(perStudent[sid])) { active.add(col.columnId); break; }
    }
  }
  return active;
}

/** Map of studentId → missing count (blanks in ACTIVE columns only). */
export function missingCounts(cols, studentIds, scores) {
  const active = activeColumnIds(cols, scores);
  const counts = new Map();
  for (const sid of studentIds) {
    let n = 0;
    for (const col of cols) {
      if (!active.has(col.columnId)) continue;
      if (!hasValue(scores?.[col.columnId]?.[sid])) n += 1;
    }
    counts.set(sid, n);
  }
  return counts;
}

/**
 * Per-column class picture: average / high / low / median over ENTERED
 * values; `missing` = students without a value; `entered` for the tooltip's
 * "25 of 40". All numbers raw (formatting is the caller's job); null stats
 * when nothing is entered.
 */
export function columnStats(columnId, studentIds, scores) {
  const values = [];
  for (const sid of studentIds) {
    const raw = scores?.[columnId]?.[sid];
    if (!hasValue(raw)) continue;
    const n = parseFloat(raw);
    if (!Number.isNaN(n)) values.push(n);
  }
  const entered = values.length;
  const missing = studentIds.length - entered;
  if (entered === 0) return { entered: 0, missing, avg: null, high: null, low: null, median: null };
  values.sort((a, b) => a - b);
  const mid = Math.floor(entered / 2);
  const median = entered % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return {
    entered,
    missing,
    avg: values.reduce((s, v) => s + v, 0) / entered,
    high: values[entered - 1],
    low: values[0],
    median,
  };
}

/**
 * The blank cells a "Fill blanks with 0" action would write, for a scope of
 * columns. `onlyActive` (assessment/period scopes) touches active columns
 * only — a column nobody has taken is left alone; an explicitly chosen
 * single column (onlyActive: false) fills regardless, because the teacher
 * pointed at it.
 */
export function blankEntries(cols, studentIds, scores, { onlyActive = true } = {}) {
  const active = onlyActive ? activeColumnIds(cols, scores) : null;
  const entries = [];
  for (const col of cols) {
    if (active && !active.has(col.columnId)) continue;
    for (const sid of studentIds) {
      if (!hasValue(scores?.[col.columnId]?.[sid])) {
        entries.push({ column_id: col.columnId, student_id: sid, value: 0 });
      }
    }
  }
  return entries;
}

/** Students whose FINAL grade sits below the threshold (cents-safe; null grades excluded). */
export function belowThreshold(students, finalGradeById, threshold) {
  const t = toCents(threshold);
  return students.filter(s => {
    const g = finalGradeById?.[s.id];
    return g !== null && g !== undefined && toCents(g) < t;
  });
}

/**
 * Rank by final grade — 'asc' puts the LOWEST first (intervention order),
 * 'desc' the highest. Students without a grade sort last either way;
 * name order breaks ties so the result is stable and predictable.
 */
export function rankOrder(students, finalGradeById, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return [...students].sort((a, b) => {
    const ga = finalGradeById?.[a.id];
    const gb = finalGradeById?.[b.id];
    const aNull = ga === null || ga === undefined;
    const bNull = gb === null || gb === undefined;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && toCents(ga) !== toCents(gb)) return sign * (toCents(ga) - toCents(gb));
    return 0; // caller supplies students in canonical (alphabetical) order — keep it for ties
  });
}
