import { createColumn, getColumnsByAssessment } from '@/lib/queries/assessments';

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    const id = await createColumn(resolvedParams.id, body);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
