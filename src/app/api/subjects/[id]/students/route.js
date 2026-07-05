import { getStudentsBySubject, createStudent } from '@/lib/queries/students';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const students = await getStudentsBySubject(resolvedParams.id);
    return Response.json(students);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    const id = await createStudent(resolvedParams.id, body);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
