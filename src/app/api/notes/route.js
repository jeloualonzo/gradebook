import { setNote, deleteNote } from '@/lib/queries/notes';

/** Upsert the note on one entity. Body: { entity_type, entity_id, subject_id, body }. */
export async function PUT(request) {
  try {
    const { entity_type, entity_id, subject_id, body } = await request.json();
    const result = await setNote({ entityType: entity_type, entityId: entity_id, subjectId: subject_id, body });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

/** Delete (tombstone) the note on one entity. Body: { entity_type, entity_id }. */
export async function DELETE(request) {
  try {
    const { entity_type, entity_id } = await request.json();
    const result = await deleteNote(entity_type, entity_id);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
