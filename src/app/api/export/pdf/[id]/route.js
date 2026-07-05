import pool from '@/lib/db';
import { computePeriodGrade, computeFinalSubjectGrade } from '@/lib/gradeCalculator';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const subjectId = resolvedParams.id;

    const [[subject]] = await pool.query('SELECT * FROM subjects WHERE id = ?', [subjectId]);
    if (!subject) return Response.json({ error: 'Not found' }, { status: 404 });

    const [students] = await pool.query(
      'SELECT * FROM students WHERE subject_id = ? ORDER BY last_name, first_name, middle_name',
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

    const rows = students.map((student, idx) => {
      const periodGrades = {};
      const rowData = { no: idx + 1, name: `${student.last_name}, ${student.first_name}` };
      for (const period of periods) {
        const grade = computePeriodGrade(period.assessments, scores, student.id);
        periodGrades[period.type] = grade;
        rowData[period.type] = grade !== null ? grade.toFixed(2) : '—';
      }
      const fg = computeFinalSubjectGrade(periodGrades, subject);
      rowData.FINAL_GRADE = fg !== null ? fg.toFixed(2) : '—';
      return rowData;
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${subject.name} Grade Sheet</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; }
  h2 { margin-bottom: 2px; }
  p { margin: 0 0 12px; color: #555; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #e8f0fe; font-weight: bold; padding: 8px 10px; border: 1px solid #ccc; text-align: center; }
  td { padding: 6px 10px; border: 1px solid #ddd; text-align: center; }
  td:nth-child(2) { text-align: left; }
  tr:nth-child(even) { background: #f9f9f9; }
  .grade-col { font-weight: 600; }
</style>
</head>
<body>
<h2>${subject.name}</h2>
<p>${subject.section} &bull; ${subject.school_year} &bull; ${subject.semester}</p>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Student Name</th>
      <th>Prelim</th>
      <th>Midterm</th>
      <th>Final</th>
      <th>Final Grade</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map(r => `
    <tr>
      <td>${r.no}</td>
      <td>${r.name}</td>
      <td class="grade-col">${r.PRELIM || '—'}</td>
      <td class="grade-col">${r.MIDTERM || '—'}</td>
      <td class="grade-col">${r.FINAL || '—'}</td>
      <td class="grade-col">${r.FINAL_GRADE}</td>
    </tr>`).join('')}
  </tbody>
</table>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `attachment; filename="${subject.name}_${subject.section}_grades.html"`,
      },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
