import db from '@/lib/db';
import { fullNameKey } from './groups';

export async function getStudentsBySubject(subjectId) {
  // Students are ALWAYS presented alphabetically (last, first, middle name)
  // everywhere in the app so instructors can locate them instantly.
  return db.all(
    `SELECT * FROM students
     WHERE subject_id = ? AND deleted_at IS NULL
     ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, middle_name COLLATE NOCASE`,
    [subjectId]
  );
}

export async function createStudent(subjectId, { last_name, first_name, middle_name = '', suffix = '' }) {
  const { maxOrder } = db.get(
    'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM students WHERE subject_id = ? AND deleted_at IS NULL',
    [subjectId]
  );
  const id = db.newId();
  const now = db.now();
  db.run(
    `INSERT INTO students (id, subject_id, last_name, first_name, middle_name, suffix, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, subjectId, last_name, first_name, middle_name || '', suffix || '', maxOrder + 1, now, now]
  );
  return id;
}

export async function updateStudent(id, { last_name, first_name, middle_name = '', suffix = '' }) {
  // Guarded write (db.updateRow): unchanged values never re-stamp updated_at.
  db.updateRow('students', id, {
    last_name,
    first_name,
    middle_name: middle_name || '',
    suffix: suffix || '',
  });
}

export async function deleteStudent(id) {
  // Soft delete (tombstone) the student and their scores so the deletion
  // propagates through sync instead of resurrecting on merge.
  const now = db.now();
  db.transaction(() => {
    db.run(
      'UPDATE scores SET deleted_at=?, updated_at=? WHERE student_id=? AND deleted_at IS NULL',
      [now, now, id]
    );
    db.run('UPDATE students SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [now, now, id]);
  });
}

/**
 * Remove every student in a subject whose name matches a member of a
 * Student Group (v1.7.0 — "I imported the wrong section"). Students carry
 * no origin link (imports copy rows, by design), so matching is by
 * full-name IDENTITY against the group's CURRENT members — the same rule
 * move-column uses. Removal tombstones student + scores (ordinary deletes;
 * they sync as such). dry_run reports the count without touching anything.
 */
export async function removeGroupStudents(subjectId, groupId, { dryRun = false } = {}) {
  let result = null;
  db.transaction(() => {
    const members = db.all(
      'SELECT last_name, first_name, middle_name, suffix FROM group_students WHERE group_id = ? AND deleted_at IS NULL',
      [groupId]
    );
    const memberKeys = new Set(members.map(fullNameKey));
    const roster = db.all(
      'SELECT * FROM students WHERE subject_id = ? AND deleted_at IS NULL',
      [subjectId]
    );
    const matched = roster.filter(s => memberKeys.has(fullNameKey(s)));
    if (dryRun) {
      result = { dry_run: true, matched: matched.length, roster: roster.length };
      return;
    }
    const now = db.now();
    for (const s of matched) {
      db.run('UPDATE scores SET deleted_at=?, updated_at=? WHERE student_id=? AND deleted_at IS NULL', [now, now, s.id]);
      db.run('UPDATE students SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [now, now, s.id]);
    }
    // removed_ids make the operation UNDOABLE (batch revive — session history).
    result = { removed: matched.length, roster: roster.length, removed_ids: matched.map(s => s.id) };
  });
  return result;
}

/**
 * Session-history workhorse (v1.7.1): tombstone or revive a specific set of
 * students in one transaction. Undoing an import removes exactly the rows
 * it created; redoing revives THE SAME rows (stable ids across undo/redo —
 * no churn for sync to chew on). Reviving restores each student plus the
 * scores tombstoned at the same instant (the matched-timestamp rule the
 * recycle bin uses), stamped with a fresh updated_at so the revival wins
 * over the tombstone everywhere (engine-tested LWW semantics).
 */
export async function setStudentsDeleted(subjectId, studentIds, { deleted }) {
  let changed = 0;
  db.transaction(() => {
    const now = db.now();
    for (const id of studentIds || []) {
      const s = db.get('SELECT * FROM students WHERE id = ? AND subject_id = ?', [id, subjectId]);
      if (!s) continue;
      if (deleted) {
        if (s.deleted_at) continue;
        db.run('UPDATE scores SET deleted_at=?, updated_at=? WHERE student_id=? AND deleted_at IS NULL', [now, now, id]);
        db.run('UPDATE students SET deleted_at=?, updated_at=? WHERE id=?', [now, now, id]);
        changed++;
      } else {
        if (!s.deleted_at) continue;
        db.run(
          'UPDATE scores SET deleted_at=NULL, updated_at=? WHERE student_id=? AND deleted_at=?',
          [now, id, s.deleted_at]
        );
        db.run('UPDATE students SET deleted_at=NULL, updated_at=? WHERE id=?', [now, id]);
        changed++;
      }
    }
  });
  return { changed };
}

export async function reorderStudents(orderedIds) {
  const now = db.now();
  db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      db.run(
        'UPDATE students SET sort_order=?, updated_at=? WHERE id=? AND sort_order != ?',
        [i, now, orderedIds[i], i]
      );
    }
  });
}
