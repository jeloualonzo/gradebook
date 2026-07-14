import { removeGroupStudents } from '@/lib/queries/students';

// Remove every student matching a Student Group's members by full-name
// identity. Body: { group_id, dry_run } — dry_run previews the count.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { group_id, dry_run = false } = await request.json();
    if (!group_id) return Response.json({ error: 'group_id is required' }, { status: 400 });
    const result = await removeGroupStudents(resolvedParams.id, group_id, { dryRun: !!dry_run });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
