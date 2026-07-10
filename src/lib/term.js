/**
 * Academic term sequencing — PURE.
 *
 * The Philippine collegiate calendar the app serves: a school year
 * ("2026-2027") carries 1st Semester → 2nd Semester → Summer. Rolling a
 * subject forward proposes the NEXT term:
 *   1st  → 2nd,   same school year
 *   2nd  → 1st,   next school year
 *   Summer → 1st, next school year
 * (2nd → Summer exists but is the exception, not the default — Summer terms
 * are opt-in; the wizard's selects stay editable for that case.)
 */
export function nextTerm(school_year, semester) {
  const m = /^(\d{4})\s*-\s*(\d{4})$/.exec(String(school_year || '').trim());
  const bump = m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : school_year;
  if (semester === '1st') return { school_year, semester: '2nd' };
  return { school_year: bump, semester: '1st' }; // 2nd and Summer both roll to next SY
}
