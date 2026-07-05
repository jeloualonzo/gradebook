import { updateAssessment, deleteAssessment, reorderAssessments } from '@/lib/queries/assessments';

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    if (body.reorder && Array.isArray(body.ids)) {
      await reorderAssessments(body.ids);
    } else {
      await updateAssessment(resolvedParams.id, body);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    await deleteAssessment(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
