import { restoreSubject } from '@/lib/queries/subjects';

// Restore a deleted subject with everything that was deleted along with it.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    await restoreSubject(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
