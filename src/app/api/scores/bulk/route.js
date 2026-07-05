import { bulkUpsertScores } from '@/lib/queries/scores';

// Bulk upsert scores: { entries: [{ column_id, student_id, value }] }
// Used by undo/redo to restore all scores of a re-created column at once.
export async function POST(request) {
  try {
    const { entries } = await request.json();
    await bulkUpsertScores(Array.isArray(entries) ? entries : []);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
