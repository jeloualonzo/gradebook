import {
  getPeriodsBySubject,
  getAssessmentsByPeriod,
  getColumnsByAssessment,
  getAttendanceConfig,
} from '@/lib/queries/assessments';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const periods = await getPeriodsBySubject(resolvedParams.id);
    const result = await Promise.all(
      periods.map(async (period) => {
        const assessments = await getAssessmentsByPeriod(period.id);
        const assessmentsWithColumns = await Promise.all(
          assessments.map(async (a) => {
            const columns = await getColumnsByAssessment(a.id);
            return { ...a, columns };
          })
        );
        const attendanceConfig = await getAttendanceConfig(period.id);
        return { ...period, assessments: assessmentsWithColumns, attendanceConfig };
      })
    );
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
