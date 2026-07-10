import { bulkUpsertScores, applyAttendanceSource } from '@/lib/queries/scores';

// Bulk upsert scores: { entries: [{ column_id, student_id, value }] }
// Used by range operations (clear/paste/fill) and by undo/redo.
export async function POST(request) {
  try {
    const { entries } = await request.json();
    const list = Array.isArray(entries) ? entries : [];
    await bulkUpsertScores(list);
    // Attendance-source parity with single-cell saves (Phase 2b): a PASTED
    // score on a counts-as-attendance column marks the student Present
    // exactly as a typed one does. The hook self-filters (flagged + dated
    // columns, blank attendance only) and runs after the bulk transaction —
    // the same ordering as the single-score route. Applications ride back
    // so the gradebook mirrors them live.
    const attendance = [];
    for (const e of list) {
      if (!e || e.value === null || e.value === undefined || e.value === '') continue;
      const applied = await applyAttendanceSource(e.column_id, e.student_id);
      if (applied) attendance.push(applied);
    }
    return Response.json({ ok: true, attendance });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
