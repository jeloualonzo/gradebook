import { createGroupFromSubject } from '@/lib/queries/groups';

// Snapshot this subject's current students as a new reusable Student Group.
// The subject itself is not modified.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { name } = await request.json();
    if (!name || !String(name).trim()) {
      return Response.json({ error: 'A group name is required.' }, { status: 400 });
    }
    const result = await createGroupFromSubject(resolvedParams.id, String(name).trim());
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
