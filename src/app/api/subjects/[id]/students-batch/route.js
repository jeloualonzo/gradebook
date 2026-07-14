import { setStudentsDeleted } from '@/lib/queries/students';

// Session-history support (v1.7.1): tombstone or revive a specific set of
// students in one transaction. Body: { action: 'remove'|'revive', student_ids }.
export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { action, student_ids } = await request.json();
    if (!['remove', 'revive'].includes(action) || !Array.isArray(student_ids)) {
      return Response.json({ error: 'action (remove|revive) and student_ids are required' }, { status: 400 });
    }
    const result = await setStudentsDeleted(resolvedParams.id, student_ids, { deleted: action === 'remove' });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
