/**
 * Student focus model — PURE. No DOM, no React, no I/O.
 *
 * Builds everything the conference-mode panel shows for ONE student from
 * data the gradebook page already holds: per-period grades, per-assessment
 * entries (date · score/max · attendance letter where applicable), and the
 * missing list under the active-column rule (consistent with the name-cell
 * chips — see classStats.js). The panel component stays a thin renderer.
 */
import { computePeriodGrade, computeFinalSubjectGrade, toCents } from './gradeCalculator.js';
import { activeColumnIds } from './classStats.js';
import { formatDateMMDDYYYY } from './dateUtils.js';

const hasValue = (v) => v !== undefined && v !== null && v !== '';

/** P/L/A letter for an attendance score under a period's config (cents-safe). */
export function attendanceLetter(value, config) {
  if (!config || value === null || value === undefined || value === '') return null;
  const v = toCents(value);
  if (v === toCents(config.present_score)) return 'P';
  if (v === toCents(config.late_score)) return 'L';
  if (v === toCents(config.absent_score)) return 'A';
  return null;
}

export function buildStudentFocus({ student, subject, periods, scores }) {
  const sid = student.id;
  const allCols = periods.flatMap(p =>
    p.assessments.flatMap(a => a.columns.map(c => ({ columnId: String(c.id) })))
  );
  const active = activeColumnIds(allCols, scores);

  const periodGrades = {};
  const missing = [];
  const outPeriods = periods.map(period => {
    const grade = computePeriodGrade(period.assessments, scores, sid);
    periodGrades[period.type] = grade;
    const isAttendance = (a) => !a.is_exam && String(a.name).toLowerCase() === 'attendance';
    return {
      type: period.type,
      grade,
      assessments: period.assessments.map(a => {
        const entries = a.columns.map(col => {
          const raw = scores?.[col.id]?.[sid];
          const entered = hasValue(raw);
          const isMissing = !entered && active.has(String(col.id));
          if (isMissing) {
            missing.push({ period: period.type, assessment: a.is_exam ? 'Exam' : a.name, date: col.date || null });
          }
          return {
            columnId: String(col.id),
            date: col.date || null,
            dateLabel: col.date ? formatDateMMDDYYYY(col.date) : '—',
            max: col.max_score,
            value: entered ? parseFloat(raw) : null,
            missing: isMissing,
            letter: isAttendance(a) ? attendanceLetter(raw, period.attendanceConfig) : null,
          };
        });
        return {
          id: a.id,
          name: a.is_exam ? 'Exam' : a.name,
          weight: parseFloat(a.weight_percent) || 0,
          entries,
          entered: entries.filter(e => e.value !== null).length,
        };
      }),
    };
  });

  return {
    periods: outPeriods,
    finalGrade: computeFinalSubjectGrade(periodGrades, subject),
    missing,
    missingCount: missing.length,
  };
}
