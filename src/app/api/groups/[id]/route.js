import { getGroupById, updateGroup, deleteGroup, getGroupStudents } from '@/lib/queries/groups';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const group = await getGroupById(resolvedParams.id);
    if (!group) return Response.json({ error: 'Not found' }, { status: 404 });
    const students = await getGroupStudents(resolvedParams.id);
    return Response.json({ ...group, students });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    if (!body?.name || !String(body.name).trim()) {
      return Response.json({ error: 'Group name is required' }, { status: 400 });
    }
    await updateGroup(resolvedParams.id, { name: String(body.name).trim(), description: body.description || '' });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    await deleteGroup(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
