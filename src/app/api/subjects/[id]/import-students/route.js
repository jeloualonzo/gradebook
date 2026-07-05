import { importGroupIntoSubject } from '@/lib/queries/groups';

// One-time COPY of a Student Group's students into this subject.
// Body: { groupId, skipDuplicates }
// New students are appended to the existing list; grades are untouched.
// Returns { imported, skipped }.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { groupId, skipDuplicates = false } = await request.json();
    if (!groupId) {
      return Response.json({ error: 'groupId is required' }, { status: 400 });
    }
    const result = await importGroupIntoSubject(resolvedParams.id, groupId, { skipDuplicates });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
