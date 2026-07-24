import { computePeriodGrade, computeFinalSubjectGrade } from '@/lib/gradeCalculator';
import { projectPeriods } from '@/lib/workspace';
import { displayName } from '@/lib/names';
import { getSubjectById } from '@/lib/queries/subjects';
import { getStudentsBySubject } from '@/lib/queries/students';
import { getPeriodsBySubject, getAssessmentsByPeriod, getColumnsByAssessment } from '@/lib/queries/assessments';
import { getScoresBySubject } from '@/lib/queries/scores';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const subjectId = resolvedParams.id;

    const subject = await getSubjectById(subjectId);
    if (!subject) return Response.json({ error: 'Not found' }, { status: 404 });

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

    // Workspace-aware view: term-span assessments project into every period
    // band so their scores count where they were earned (v1.9.0).
    const viewPeriods = projectPeriods(periods);
    const rows = students.map((student, idx) => {
      const periodGrades = {};
      const rowData = { no: idx + 1, name: displayName(student) };
      for (const period of viewPeriods) {
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
