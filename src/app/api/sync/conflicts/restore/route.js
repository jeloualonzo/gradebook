import { restoreConflictLoser, unreviewedConflictCount } from '@/lib/sync';

/**
 * Restore the losing version of a conflict — written as an ORDINARY new
 * edit (fresh updated_at from this device), so it propagates through
 * normal sync and wins on the other laptop too. The merge engine is not
 * involved; the replaced value remains visible in the conflict entry.
 */
export async function POST(request) {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
    const result = restoreConflictLoser(id);
    return Response.json({ ok: true, ...result, unreviewed: unreviewedConflictCount() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
