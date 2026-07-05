import { createAssessment, getAssessmentsByPeriod } from '@/lib/queries/assessments';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const assessments = await getAssessmentsByPeriod(resolvedParams.id);
    return Response.json(assessments);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    const existing = await getAssessmentsByPeriod(resolvedParams.id);
    const sortOrder = existing.length;
    const id = await createAssessment(resolvedParams.id, { ...body, sort_order: sortOrder });
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
