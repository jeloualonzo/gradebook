import { runSync } from '@/lib/sync';

// Run one sync pass: merge every peer snapshot in the folder, then export
// the (merged) local state. Idempotent — safe to run any number of times.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = runSync({ force: !!body?.force });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
