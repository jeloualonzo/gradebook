/**
 * Computes the weighted average grade for a single grading period.
 *
 * @param {Array} assessments - assessments for the period, each with:
 *   { id, weight_percent, columns: [{ id, max_score }] }
 * @param {Object} scores - map of { [columnId]: { [studentId]: value } }
 * @param {number} studentId
 * @returns {number|null} - grade 0-100 or null if no data
 */
export function computePeriodGrade(assessments, scores, studentId) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const assessment of assessments) {
    const weight = parseFloat(assessment.weight_percent) || 0;
    if (weight === 0) continue;

    const columns = assessment.columns || [];
    if (columns.length === 0) continue;

    let totalScore = 0;
    let totalMax = 0;

    for (const col of columns) {
      const raw = scores?.[col.id]?.[studentId];
      const val = raw !== undefined && raw !== null && raw !== '' ? parseFloat(raw) : null;
      const max = parseFloat(col.max_score) || 0;
      if (max > 0 && val !== null) {
        totalScore += val;
        totalMax += max;
      }
    }

    if (totalMax === 0) continue;

    const categoryPct = (totalScore / totalMax) * 100;
    weightedSum += categoryPct * (weight / 100);
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return (weightedSum / totalWeight) * 100;
}

/**
 * Computes the final subject grade for a student.
 *
 * @param {Object} periodGrades - { PRELIM: number|null, MIDTERM: number|null, FINAL: number|null }
 * @param {Object} subject - { prelim_weight, midterm_weight, final_weight }
 * @returns {number|null}
 */
export function computeFinalGrade(periodGrades, subject) {
  const pw = parseFloat(subject.prelim_weight) || 0;
  const mw = parseFloat(subject.midterm_weight) || 0;
  const fw = parseFloat(subject.final_weight) || 0;
  const totalW = pw + mw + fw;
  if (totalW === 0) return null;

  let sum = 0;
  let usedWeight = 0;

  if (periodGrades.PRELIM !== null && periodGrades.PRELIM !== undefined) {
    sum += periodGrades.PRELIM * (pw / totalW);
    usedWeight += pw;
  }
  if (periodGrades.MIDTERM !== null && periodGrades.MIDTERM !== undefined) {
    sum += periodGrades.MIDTERM * (mw / totalW);
    usedWeight += mw;
  }
  if (periodGrades.FINAL !== null && periodGrades.FINAL !== undefined) {
    sum += periodGrades.FINAL * (fw / totalW);
    usedWeight += fw;
  }

  if (usedWeight === 0) return null;
  return (sum / usedWeight) * usedWeight + sum * (1 - usedWeight / totalW);
}

/**
 * Computes grades for all students across all periods for a subject.
 *
 * @param {Object} gradebookData - { subject, periods: [{ type, assessments: [...] }], scores }
 * @param {Array} students
 * @returns {Object} { [studentId]: { PRELIM, MIDTERM, FINAL, FINAL_GRADE } }
 */
export function computeAllGrades(gradebookData, students) {
  const { subject, periods, scores } = gradebookData;
  const result = {};

  for (const student of students) {
    const sid = student.id;
    const periodGrades = {};

    for (const period of periods) {
      const grade = computePeriodGrade(period.assessments, scores, sid);
      periodGrades[period.type] = grade;
    }

    const finalGrade = computeFinalSubjectGrade(periodGrades, subject);

    result[sid] = {
      PRELIM: periodGrades.PRELIM,
      MIDTERM: periodGrades.MIDTERM,
      FINAL: periodGrades.FINAL,
      FINAL_GRADE: finalGrade,
    };
  }

  return result;
}

export function computeFinalSubjectGrade(periodGrades, subject) {
  const pw = parseFloat(subject.prelim_weight) || 0;
  const mw = parseFloat(subject.midterm_weight) || 0;
  const fw = parseFloat(subject.final_weight) || 0;
  const totalW = pw + mw + fw;
  if (totalW === 0) return null;

  let weightedSum = 0;
  let appliedWeight = 0;

  if (periodGrades.PRELIM !== null && periodGrades.PRELIM !== undefined) {
    weightedSum += periodGrades.PRELIM * pw;
    appliedWeight += pw;
  }
  if (periodGrades.MIDTERM !== null && periodGrades.MIDTERM !== undefined) {
    weightedSum += periodGrades.MIDTERM * mw;
    appliedWeight += mw;
  }
  if (periodGrades.FINAL !== null && periodGrades.FINAL !== undefined) {
    weightedSum += periodGrades.FINAL * fw;
    appliedWeight += fw;
  }

  if (appliedWeight === 0) return null;
  return weightedSum / appliedWeight;
}

export function formatGrade(value) {
  if (value === null || value === undefined) return '—';
  return formatNumber(parseFloat(value));
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  const num = parseFloat(value);
  if (isNaN(num)) return '—';
  if (Number.isInteger(num)) return String(num);
  return String(parseFloat(num.toFixed(2)));
}

/**
 * Convert a percentage value (string or number) to integer cents
 * (hundredths). All weight totals and comparisons use integer cents so
 * floating-point drift can never corrupt user-entered values:
 * e.g. 33.33 + 33.33 + 33.34 sums to exactly 10000 cents (100%).
 */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = parseFloat(value);
  if (!isFinite(num)) return 0;
  return Math.round(num * 100);
}

/** Integer cents → clean display/storage number (40, 10.5, 33.33 — no drift). */
export function centsToNumber(cents) {
  return cents / 100;
}
