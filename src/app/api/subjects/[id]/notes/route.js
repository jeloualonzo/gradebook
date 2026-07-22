import { getNotesBySubject } from '@/lib/queries/notes';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const notes = await getNotesBySubject(id);
    return Response.json(notes);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
