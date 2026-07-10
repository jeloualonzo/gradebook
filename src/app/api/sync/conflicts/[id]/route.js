import { conflictDetails } from '@/lib/sync';

/**
 * Full details for one conflict, in gradebook language: context rows
 * (subject, period, assessment, date, student …) plus an entity-appropriate
 * Previous/Current comparison — a miniature gradebook for scores, a field
 * table for everything else. Read-only.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const details = conflictDetails(id);
    if (!details) return Response.json({ error: 'Conflict entry not found' }, { status: 404 });
    return Response.json(details);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
