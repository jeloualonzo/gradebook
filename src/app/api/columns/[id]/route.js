import { updateColumn, deleteColumn } from '@/lib/queries/assessments';

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    await updateColumn(resolvedParams.id, body);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    await deleteColumn(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
