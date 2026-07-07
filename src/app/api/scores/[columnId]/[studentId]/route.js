import { upsertScore, applyAttendanceSource } from '@/lib/queries/scores';

export async function PUT(request, { params }) {
  try {
    const { value } = await request.json();
    const resolvedParams = await params;
    const { columnId, studentId } = resolvedParams;
    await upsertScore(columnId, studentId, value);
    // A real score on an attendance-source column marks the student Present
    // for the same date (blank attendance only — never overwrites).
    if (value !== null && value !== undefined && value !== '') {
      await applyAttendanceSource(columnId, studentId);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
