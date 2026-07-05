import pool from '@/lib/db';
import ExcelJS from 'exceljs';
import { computePeriodGrade, computeFinalSubjectGrade, formatGrade } from '@/lib/gradeCalculator';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const subjectId = resolvedParams.id;

    const [[subject]] = await pool.query('SELECT * FROM subjects WHERE id = ?', [subjectId]);
    if (!subject) return Response.json({ error: 'Not found' }, { status: 404 });

    const [students] = await pool.query(
      'SELECT * FROM students WHERE subject_id = ? ORDER BY sort_order, last_name',
      [subjectId]
    );

    const [periods] = await pool.query(
      'SELECT * FROM grading_periods WHERE subject_id = ? ORDER BY FIELD(type,"PRELIM","MIDTERM","FINAL")',
      [subjectId]
    );

    for (const period of periods) {
      const [assessments] = await pool.query(
        'SELECT * FROM assessments WHERE period_id = ? ORDER BY sort_order',
        [period.id]
      );
      for (const a of assessments) {
        const [cols] = await pool.query(
          'SELECT * FROM assessment_columns WHERE assessment_id = ? ORDER BY date',
          [a.id]
        );
        a.columns = cols;
      }
      period.assessments = assessments;
    }

    const [scoreRows] = await pool.query(
      `SELECT s.column_id, s.student_id, s.value FROM scores s
       JOIN assessment_columns ac ON ac.id = s.column_id
       JOIN assessments a ON a.id = ac.assessment_id
       JOIN grading_periods gp ON gp.id = a.period_id
       WHERE gp.subject_id = ?`,
      [subjectId]
    );
    const scores = {};
    for (const row of scoreRows) {
      if (!scores[row.column_id]) scores[row.column_id] = {};
      scores[row.column_id][row.student_id] = row.value;
    }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(`${subject.name} - ${subject.section}`);

    const titleRow = ws.addRow([`${subject.name} | ${subject.section} | ${subject.school_year} | ${subject.semester}`]);
    titleRow.font = { bold: true, size: 13 };
    ws.addRow([]);

    const headers = ['#', 'Last Name', 'First Name'];
    for (const period of periods) {
      for (const a of period.assessments) {
        for (const col of a.columns) {
          headers.push(`${period.type} - ${a.name}\n${col.date}`);
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
      const row = [idx + 1, student.last_name, student.first_name];
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
      col.width = i < 3 ? 20 : 14;
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
