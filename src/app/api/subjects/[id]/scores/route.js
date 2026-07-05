import { getScoresBySubject } from '@/lib/queries/scores';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const rows = await getScoresBySubject(resolvedParams.id);
    const scoreMap = {};
    for (const row of rows) {
      if (!scoreMap[row.column_id]) scoreMap[row.column_id] = {};
      scoreMap[row.column_id][row.student_id] = row.value;
    }
    return Response.json(scoreMap);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
