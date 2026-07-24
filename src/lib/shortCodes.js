/**
 * Automatic assessment short codes (v1.8.0, redesigned v1.9.0) — the compact
 * labels teachers pencil under dates in a paper class record: Q1 Q2 A3 ACT1…
 *
 * PURE module (unit-tested in scripts/test-formatting.mjs).
 *
 * Codes are DERIVED at render time from the assessment's name and the
 * column's position in the current (alive, sorted) column list — nothing is
 * stored for automatic codes, so re-ordering or deleting a column re-numbers
 * them correctly BY CONSTRUCTION. A column's `label` field (schema v9)
 * OVERRIDES the automatic code when set: manual names are preserved forever;
 * empty label = automatic sequencing continues.
 *
 * Abbreviation convention (v1.9.0, owner-approved): the bare `A` goes to
 * Attendance — the most frequent category earns the shortest code — and the
 * A/AS/AT ambiguity triangle is dissolved by giving Activity a distinct
 * three-letter ACT. Everything is numbered, exams included (E1): one rule,
 * no exceptions. Unknown categories fall back to word initials ("Machine
 * Problem" → MP) or the first two letters of a single word.
 */

const KNOWN = [
  [/^quiz(zes)?$/, 'Q'],
  [/^attendance$/, 'A'],
  [/^activit(y|ies)$/, 'ACT'],
  [/^assignments?$/, 'AS'],
  [/^seat ?works?$/, 'SW'],
  [/^lab(oratory|oratories|s)?$/, 'L'],
  [/^exams?$/, 'E'],
  [/^performance ?tasks?$/, 'PT'],
  [/^projects?$/, 'P'],
  [/^recitations?$/, 'R'],
  [/^oral ?(participation|recitation)$/, 'OP'],
  [/^report(ing|s)?$/, 'REP'],
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

/** "Quiz 3" / "Attendance 12" / "Exam 1" — the tooltip long form. */
export function columnLongName(assessment, index) {
  return `${assessment?.is_exam ? 'Exam' : String(assessment?.name || '').trim() || 'Column'} ${index + 1}`;
}

/**
 * Display codes for an assessment's columns, in the given (alive, sorted)
 * order. Manual labels win; automatic codes number by POSITION, so the
 * sequence always mirrors the current column order — a manual override on
 * one column never shifts its neighbors' numbers.
 */
export function columnCodes(assessment, columns = assessment?.columns || []) {
  const base = assessmentCode(assessment);
  return columns.map((c, i) => {
    const manual = String(c?.label || '').trim();
    return manual || `${base}${i + 1}`;
  });
}

/**
 * Everything the header row needs per column:
 *   { code, long, manual } — code = what the cell shows, long = "Quiz 3"
 * (the tooltip: the actual assessment name, never the word "automatic"),
 * manual = whether the code is a preserved instructor override.
 */
export function columnCodeInfo(assessment, columns = assessment?.columns || []) {
  const base = assessmentCode(assessment);
  return columns.map((c, i) => {
    const manual = String(c?.label || '').trim();
    return {
      code: manual || `${base}${i + 1}`,
      auto: `${base}${i + 1}`,
      long: columnLongName(assessment, i),
      manual: !!manual,
    };
  });
}
