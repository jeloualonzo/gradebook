import { moveColumnToSubject } from '@/lib/queries/assessments';

// Move one date column (with its scores, matched by student identity) to
// another subject / period / assessment category. dry_run returns the match
// preview without changing anything.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    const result = await moveColumnToSubject(resolvedParams.id, {
      subjectId: body.subject_id,
      periodType: body.period_type,
      assessmentName: body.assessment_name,
      createMissingStudents: !!body.create_missing_students,
      dryRun: !!body.dry_run,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
