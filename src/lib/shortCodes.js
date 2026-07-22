/**
 * Automatic assessment short codes (v1.8.0) — the compact labels teachers
 * pencil under dates in a paper class record: Q1 Q2 A1 AS1 L1 AT1 SW1 …
 *
 * PURE module (unit-tested in scripts/test-formatting.mjs). Codes are
 * DERIVED at render time from the assessment's name and the column's
 * position in the current (alive, sorted) column list — nothing is stored,
 * so re-ordering or deleting a column re-numbers the codes correctly BY
 * CONSTRUCTION and there is nothing to migrate or sync.
 *
 * Abbreviations: the common Philippine class-record categories get their
 * conventional letters; anything else falls back to word initials
 * ("Machine Problem" → MP) or the first two letters of a single word
 * ("Portfolio" → PO). Numbering restarts per assessment (and therefore per
 * grading period, since assessments belong to periods) — Prelim Q1..Q3 and
 * Midterm Q1..Q2 is exactly how the paper record reads.
 */

const KNOWN = [
  [/^quiz(zes)?$/, 'Q'],
  [/^activit(y|ies)$/, 'A'],
  [/^assignments?$/, 'AS'],
  [/^lab(oratory|oratories|s)?$/, 'L'],
  [/^attendance$/, 'AT'],
  [/^seat ?works?$/, 'SW'],
  [/^projects?$/, 'P'],
  [/^recitations?$/, 'R'],
  [/^exams?$/, 'E'],
];

/** The letter prefix for one assessment ({ name, is_exam }). */
export function assessmentCode(assessment) {
  if (assessment?.is_exam) return 'E';
  const name = String(assessment?.name || '').trim();
  const lower = name.toLowerCase();
  for (const [re, code] of KNOWN) {
    if (re.test(lower)) return code;
  }
  // Fallback: initials of up to three words, or the first two letters of a
  // single word — always at least one character, always uppercase.
  const words = name.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
  }
  return (name.slice(0, 2) || '?').toUpperCase();
}

/**
 * Codes for an assessment's columns, in the given (alive, sorted) order.
 * The exam's single auto-column reads as plain "E" — "E1" would imply a
 * series that can't exist.
 */
export function columnCodes(assessment, columns = assessment?.columns || []) {
  const base = assessmentCode(assessment);
  if (assessment?.is_exam && columns.length === 1) return ['E'];
  return columns.map((c, i) => `${base}${i + 1}`);
}
