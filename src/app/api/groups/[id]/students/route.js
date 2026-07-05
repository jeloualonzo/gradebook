import { getGroupStudents, createGroupStudent } from '@/lib/queries/groups';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const students = await getGroupStudents(resolvedParams.id);
    return Response.json(students);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    const id = await createGroupStudent(resolvedParams.id, body);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
