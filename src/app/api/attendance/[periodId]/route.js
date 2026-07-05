import { upsertAttendanceConfig, getAttendanceConfig } from '@/lib/queries/assessments';
import { bulkUpsertScores } from '@/lib/queries/scores';
import pool from '@/lib/db';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const config = await getAttendanceConfig(resolvedParams.periodId);
    return Response.json(config);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const resolvedParams = await params;
    const body = await request.json();
    await upsertAttendanceConfig(resolvedParams.periodId, body);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const { columnId, entries } = await request.json();
    await bulkUpsertScores(entries.map(e => ({ column_id: columnId, student_id: e.student_id, value: e.value })));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
