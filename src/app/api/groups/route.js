import { getAllGroups, createGroup } from '@/lib/queries/groups';

export async function GET() {
  try {
    const groups = await getAllGroups();
    return Response.json(groups);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body?.name || !String(body.name).trim()) {
      return Response.json({ error: 'Group name is required' }, { status: 400 });
    }
    const id = await createGroup({ name: String(body.name).trim(), description: body.description || '' });
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
