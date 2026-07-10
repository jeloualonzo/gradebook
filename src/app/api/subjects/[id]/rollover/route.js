import { rolloverSubject } from '@/lib/queries/subjects';

// Semester rollover: a new subject for a new term — structure always,
// roster by choice ('empty' | 'copy' | 'group'), scores never.
// Body: { name, subject_code, section, school_year, semester, roster, group_id }
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    const id = await rolloverSubject(resolvedParams.id, body);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
