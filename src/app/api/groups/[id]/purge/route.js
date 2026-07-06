import { purgeGroup } from '@/lib/queries/groups';

// Permanently delete: hide from the recycle bin everywhere (the underlying
// tombstone stays, which is what keeps sync consistent).
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    await purgeGroup(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
