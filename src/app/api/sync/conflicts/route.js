import { listConflicts, markConflictsReviewed, unreviewedConflictCount } from '@/lib/sync';

/**
 * Conflicts sync has resolved (newest-wins) on THIS laptop. Every entry
 * keeps BOTH versions, so nothing is ever silently lost — the review UI
 * (Settings → Sync Conflicts) can restore the discarded value at any time.
 *
 * GET ?subjectId=…&unreviewedOnly=1&limit=…  → { conflicts, unreviewed }
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const subjectId = url.searchParams.get('subjectId');
    const unreviewedOnly = url.searchParams.get('unreviewedOnly') === '1';
    const limit = parseInt(url.searchParams.get('limit'), 10) || 100;
    let conflicts = listConflicts(limit);
    if (subjectId) conflicts = conflicts.filter(c => c.subject_id === subjectId);
    if (unreviewedOnly) conflicts = conflicts.filter(c => !c.reviewed_at);
    return Response.json({ conflicts, unreviewed: unreviewedConflictCount() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/** Mark conflicts as reviewed: { ids: [...] } or { all: true }. */
export async function PUT(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const reviewed = markConflictsReviewed({ ids: body.ids, all: !!body.all });
    return Response.json({ reviewed, unreviewed: unreviewedConflictCount() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
