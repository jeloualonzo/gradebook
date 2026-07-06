import { purgeSubject } from '@/lib/queries/subjects';

// Permanently delete: hide from the recycle bin everywhere (the underlying
// tombstone stays, which is what keeps sync consistent).
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    await purgeSubject(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
