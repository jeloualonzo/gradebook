import db from '@/lib/db';
import { updateColumn, deleteColumn } from '@/lib/queries/assessments';
import { applyAttendanceSource } from '@/lib/queries/scores';

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();

    // Retroactive counts-as-attendance (v1.7.1): when the flag transitions
    // 0 → 1, every EXISTING score on this column is processed exactly as if
    // the option had always been on — the same hook the live path uses, so
    // the same guarantees hold: blanks-only, never overwrites a Late/Absent,
    // creates the dated attendance column if missing. Turning the flag OFF
    // stays inert by design: attendance already written (manual or
    // backfilled) is never deleted (AGENTS.md §14).
    const before = body.attendance_source !== undefined
      ? db.get('SELECT attendance_source FROM assessment_columns WHERE id = ?', [resolvedParams.id])
      : null;
    await updateColumn(resolvedParams.id, body);

    let backfilled = 0;
    if (before && !before.attendance_source && body.attendance_source) {
      const scored = db.all(
        `SELECT student_id FROM scores
          WHERE column_id = ? AND deleted_at IS NULL AND value IS NOT NULL`,
        [resolvedParams.id]
      );
      for (const s of scored) {
        const applied = await applyAttendanceSource(resolvedParams.id, s.student_id);
        if (applied?.applied) backfilled++;
      }
    }
    return Response.json({ ok: true, attendance_backfilled: backfilled });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const resolvedParams = await params;
    await deleteColumn(resolvedParams.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
