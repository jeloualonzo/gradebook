import { createPeriod, createAssessment, upsertAttendanceConfig, normalizeExamLast } from '@/lib/queries/assessments';

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { periods } = await request.json();
    const subjectId = resolvedParams.id;

    for (const periodData of periods) {
      const periodId = await createPeriod(subjectId, periodData.type);

      await upsertAttendanceConfig(periodId, {
        present_score: 10,
        late_score: 8,
        absent_score: 0,
      });

      for (let i = 0; i < periodData.assessments.length; i++) {
        const a = periodData.assessments[i];
        await createAssessment(periodId, {
          name: a.name,
          is_exam: a.is_exam ? 1 : 0,
          sort_order: i,
          weight_percent: a.weight_percent || 0,
        });
      }
      // The exam always ends up last, regardless of the submitted order.
      await normalizeExamLast(periodId);
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
