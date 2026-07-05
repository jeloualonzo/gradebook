import { upsertScore } from '@/lib/queries/scores';

export async function PUT(request, { params }) {
  try {
    const { value } = await request.json();
    const resolvedParams = await params;
    const { columnId, studentId } = resolvedParams;
    await upsertScore(columnId, studentId, value);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
