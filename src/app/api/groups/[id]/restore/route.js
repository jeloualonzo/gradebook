import { restoreGroup } from '@/lib/queries/groups';

// Restore a deleted student group with all members deleted along with it.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    await restoreGroup(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
