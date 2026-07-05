import { getSubjectById, updateSubject, deleteSubject } from '@/lib/queries/subjects';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const subject = await getSubjectById(resolvedParams.id);
    if (!subject) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(subject);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    await updateSubject(resolvedParams.id, body);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    await deleteSubject(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
