import { updateGroupStudent, deleteGroupStudent, reorderGroupStudents } from '@/lib/queries/groups';

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    if (body.reorder && Array.isArray(body.ids)) {
      await reorderGroupStudents(body.ids);
    } else {
      await updateGroupStudent(resolvedParams.id, body);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    await deleteGroupStudent(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
