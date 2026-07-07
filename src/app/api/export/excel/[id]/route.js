import ExcelJS from 'exceljs';
import { computePeriodGrade, computeFinalSubjectGrade } from '@/lib/gradeCalculator';
import { formatDateMMDDYYYY } from '@/lib/dateUtils';
import { displayName } from '@/lib/names';
import { getSubjectById } from '@/lib/queries/subjects';
import { getStudentsBySubject } from '@/lib/queries/students';
import { getPeriodsBySubject, getAssessmentsByPeriod, getColumnsByAssessment } from '@/lib/queries/assessments';
import { getScoresBySubject } from '@/lib/queries/scores';

async function loadSubjectData(subjectId) {
  const subject = await getSubjectById(subjectId);
  if (!subject) return null;
  const students = await getStudentsBySubject(subjectId);
  const periods = await getPeriodsBySubject(subjectId);
  for (const period of periods) {
    const assessments = await getAssessmentsByPeriod(period.id);
    for (const a of assessments) {
      a.columns = await getColumnsByAssessment(a.id);
    }
    period.assessments = assessments;
  }
  const scoreRows = await getScoresBySubject(subjectId);
  const scores = {};
  for (const row of scoreRows) {
    if (!scores[row.column_id]) scores[row.column_id] = {};
    scores[row.column_id][row.student_id] = row.value;
  }
  return { subject, students, periods, scores };
}

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const data = await loadSubjectData(resolvedParams.id);
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 });
    const { subject, students, periods, scores } = data;

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(`${subject.name} - ${subject.section}`);

    const titleRow = ws.addRow([`${subject.subject_code ? subject.subject_code + " — " : ""}${subject.name} | ${subject.section} | ${subject.school_year} | ${subject.semester}`]);
    titleRow.font = { bold: true, size: 13 };
    ws.addRow([]);

    const headers = ['#', 'Student Name'];
    for (const period of periods) {
      for (const a of period.assessments) {
        for (const col of a.columns) {
          headers.push(`${period.type} - ${a.is_exam ? 'Exam' : a.name}\n${col.date ? formatDateMMDDYYYY(col.date) : '--'}`);
        }
      }
      headers.push(`${period.type} Grade`);
    }
    headers.push('Final Grade');

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };

    students.forEach((student, idx) => {
      const row = [idx + 1, displayName(student)];
      const periodGrades = {};
      for (const period of periods) {
        for (const a of period.assessments) {
          for (const col of a.columns) {
            const v = scores[col.id]?.[student.id];
            row.push(v !== undefined && v !== null ? parseFloat(v) : '');
          }
        }
        const grade = computePeriodGrade(period.assessments, scores, student.id);
        periodGrades[period.type] = grade;
        row.push(grade !== null ? parseFloat(grade.toFixed(2)) : '');
      }
      const fg = computeFinalSubjectGrade(periodGrades, subject);
      row.push(fg !== null ? parseFloat(fg.toFixed(2)) : '');
      ws.addRow(row);
    });

    ws.columns.forEach((col, i) => {
      col.width = i === 0 ? 6 : i === 1 ? 30 : 14;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${subject.name}_${subject.section}.xlsx"`,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
