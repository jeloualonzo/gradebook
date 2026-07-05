import { getAllSubjects, createSubject } from '@/lib/queries/subjects';

export async function GET() {
  try {
    const subjects = await getAllSubjects();
    return Response.json(subjects);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const id = await createSubject(body);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
