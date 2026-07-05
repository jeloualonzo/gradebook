import { duplicateGroup } from '@/lib/queries/groups';

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const newId = await duplicateGroup(resolvedParams.id);
    return Response.json({ id: newId }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
