import db from '@/lib/db';

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

export async function createStudent(subjectId, { last_name, first_name, middle_name = '' }) {
  const { maxOrder } = db.get(
    'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM students WHERE subject_id = ? AND deleted_at IS NULL',
    [subjectId]
  );
  const id = db.newId();
  const now = db.now();
  db.run(
    `INSERT INTO students (id, subject_id, last_name, first_name, middle_name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, subjectId, last_name, first_name, middle_name || '', maxOrder + 1, now, now]
  );
  return id;
}

export async function updateStudent(id, { last_name, first_name, middle_name = '' }) {
  db.run(
    'UPDATE students SET last_name=?, first_name=?, middle_name=?, updated_at=? WHERE id=?',
    [last_name, first_name, middle_name || '', db.now(), id]
  );
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
