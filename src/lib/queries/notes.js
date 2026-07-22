import db from '@/lib/db';

/**
 * Free-form notes (v1.8.0) — one polymorphic table for every annotation
 * level. Notes are INDEPENDENT data: nothing in the score/column lifecycle
 * touches them — a cell's score can be cleared, re-entered, or synced away
 * while its note stays exactly where it was, until the note itself is
 * deleted. (Owner-specified semantics: no hidden coupling.)
 *
 * entity_type / entity_id:
 *   'column'  → assessment_columns.id
 *   'cell'    → `${column_id}:${student_id}` (UUIDs never contain ':')
 *   'student' → students.id   (data model ready; UI is future work)
 *   'subject' → subjects.id   (data model ready; UI is future work)
 */

export const NOTE_ENTITY_TYPES = ['subject', 'student', 'column', 'cell'];

export const cellEntityId = (columnId, studentId) => `${columnId}:${studentId}`;

/** Every ALIVE note for one subject, one indexed query. */
export async function getNotesBySubject(subjectId) {
  return db.all(
    `SELECT id, entity_type, entity_id, body, updated_at
       FROM notes
      WHERE subject_id = ? AND deleted_at IS NULL`,
    [subjectId]
  );
}

/**
 * Create or update the note on one entity (natural key: entity_type +
 * entity_id). A tombstoned note on the same entity is REVIVED — the row
 * identity is stable, so a delete → re-add round trip never duplicates.
 * No-op saves (unchanged body) never restamp updated_at (db.updateRow).
 */
export async function setNote({ entityType, entityId, subjectId, body }) {
  if (!NOTE_ENTITY_TYPES.includes(entityType)) throw new Error('Unknown note entity type');
  if (!entityId) throw new Error('entity_id is required');
  const text = String(body ?? '').trim();
  if (!text) throw new Error('A note needs some text — use delete to remove it.');

  const existing = db.get(
    'SELECT * FROM notes WHERE entity_type = ? AND entity_id = ?',
    [entityType, entityId]
  );
  if (existing) {
    db.updateRow('notes', existing.id, {
      body: text,
      subject_id: subjectId ?? existing.subject_id,
      deleted_at: null, // revive if tombstoned
    });
    return { id: existing.id, body: text };
  }
  const now = db.now();
  const id = db.newId();
  db.run(
    `INSERT INTO notes (id, entity_type, entity_id, subject_id, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, entityType, entityId, subjectId ?? null, text, now, now]
  );
  return { id, body: text };
}

/** Tombstone the note on one entity (the deletion syncs; revivable). */
export async function deleteNote(entityType, entityId) {
  const existing = db.get(
    'SELECT id, deleted_at FROM notes WHERE entity_type = ? AND entity_id = ?',
    [entityType, entityId]
  );
  if (!existing || existing.deleted_at) return { deleted: false };
  db.updateRow('notes', existing.id, { deleted_at: db.now() });
  return { deleted: true };
}
