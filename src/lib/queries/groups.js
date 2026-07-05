import db from '@/lib/db';

/**
 * Student Groups: reusable rosters independent from any subject.
 * Importing into a subject always COPIES students (never links), so grading
 * data stays independent even if the group changes later.
 */

// Case-insensitive identity used for duplicate detection:
// First Name + Middle Name + Last Name (trimmed).
export function fullNameKey({ first_name = '', middle_name = '', last_name = '' }) {
  return [first_name, middle_name, last_name]
    .map(s => String(s || '').trim().toLowerCase())
    .join('|');
}

export async function getAllGroups() {
  return db.all(
    `SELECT g.*, COUNT(gs.id) AS student_count
     FROM student_groups g
     LEFT JOIN group_students gs ON gs.group_id = g.id AND gs.deleted_at IS NULL
     WHERE g.deleted_at IS NULL
     GROUP BY g.id
     ORDER BY g.created_at DESC`
  );
}

export async function getGroupById(id) {
  return db.get('SELECT * FROM student_groups WHERE id = ? AND deleted_at IS NULL', [id]) || null;
}

export async function createGroup({ name, description = '' }) {
  const id = db.newId();
  const now = db.now();
  db.run(
    'INSERT INTO student_groups (id, name, description, owner_device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, description || '', db.getDeviceId(), now, now]
  );
  return id;
}

export async function updateGroup(id, { name, description = '' }) {
  db.run(
    'UPDATE student_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?',
    [name, description || '', db.now(), id]
  );
}

export async function deleteGroup(id) {
  const now = db.now();
  db.transaction(() => {
    db.run('UPDATE group_students SET deleted_at=?, updated_at=? WHERE group_id=? AND deleted_at IS NULL', [now, now, id]);
    db.run('UPDATE student_groups SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [now, now, id]);
  });
}

export async function duplicateGroup(id) {
  let newGroupId = null;
  db.transaction(() => {
    const src = db.get('SELECT * FROM student_groups WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!src) throw new Error('Group not found');
    const now = db.now();
    newGroupId = db.newId();
    db.run(
      'INSERT INTO student_groups (id, name, description, owner_device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [newGroupId, `${src.name} (Copy)`, src.description, db.getDeviceId(), now, now]
    );
    const students = db.all(
      `SELECT * FROM group_students WHERE group_id = ? AND deleted_at IS NULL
       ORDER BY sort_order, last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
      [id]
    );
    for (const s of students) {
      db.run(
        'INSERT INTO group_students (id, group_id, last_name, first_name, middle_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [db.newId(), newGroupId, s.last_name, s.first_name, s.middle_name, s.sort_order, now, now]
      );
    }
  });
  return newGroupId;
}

export async function getGroupStudents(groupId) {
  return db.all(
    `SELECT * FROM group_students WHERE group_id = ? AND deleted_at IS NULL
     ORDER BY sort_order, last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
    [groupId]
  );
}

export async function createGroupStudent(groupId, { last_name, first_name, middle_name = '' }) {
  const { maxOrder } = db.get(
    'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM group_students WHERE group_id = ? AND deleted_at IS NULL',
    [groupId]
  );
  const id = db.newId();
  const now = db.now();
  db.run(
    'INSERT INTO group_students (id, group_id, last_name, first_name, middle_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, groupId, last_name, first_name, middle_name || '', maxOrder + 1, now, now]
  );
  return id;
}

export async function updateGroupStudent(id, { last_name, first_name, middle_name = '' }) {
  db.run(
    'UPDATE group_students SET last_name=?, first_name=?, middle_name=?, updated_at=? WHERE id=?',
    [last_name, first_name, middle_name || '', db.now(), id]
  );
}

export async function deleteGroupStudent(id) {
  db.run('UPDATE group_students SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [db.now(), db.now(), id]);
}

export async function reorderGroupStudents(orderedIds) {
  const now = db.now();
  db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      db.run(
        'UPDATE group_students SET sort_order=?, updated_at=? WHERE id=? AND sort_order != ?',
        [i, now, orderedIds[i], i]
      );
    }
  });
}

/**
 * Bulk-add students to a group (used by Excel import).
 * Never creates duplicates within the group (same full name, case-insensitive,
 * against existing members or within the payload). Returns { added, skipped }.
 */
export async function bulkAddGroupStudents(groupId, students) {
  let added = 0;
  let skipped = 0;
  db.transaction(() => {
    const existing = db.all(
      'SELECT first_name, middle_name, last_name FROM group_students WHERE group_id = ? AND deleted_at IS NULL',
      [groupId]
    );
    const seen = new Set(existing.map(fullNameKey));
    const { maxOrder } = db.get(
      'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM group_students WHERE group_id = ? AND deleted_at IS NULL',
      [groupId]
    );
    let order = maxOrder + 1;
    const now = db.now();
    for (const s of students || []) {
      const student = {
        first_name: String(s.first_name || '').trim(),
        middle_name: String(s.middle_name || '').trim(),
        last_name: String(s.last_name || '').trim(),
      };
      if (!student.first_name && !student.last_name) continue; // blank row
      const key = fullNameKey(student);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      db.run(
        'INSERT INTO group_students (id, group_id, last_name, first_name, middle_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [db.newId(), groupId, student.last_name, student.first_name, student.middle_name, order++, now, now]
      );
      added++;
    }
  });
  return { added, skipped };
}

/**
 * One-time COPY of a group's students into a subject. New students are
 * appended after the subject's existing list; existing grades are untouched.
 * Returns { imported, skipped }.
 */
export async function importGroupIntoSubject(subjectId, groupId, { skipDuplicates = false } = {}) {
  let imported = 0;
  let skipped = 0;
  db.transaction(() => {
    const groupStudents = db.all(
      `SELECT * FROM group_students WHERE group_id = ? AND deleted_at IS NULL
       ORDER BY sort_order, last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
      [groupId]
    );
    const existing = db.all(
      'SELECT first_name, middle_name, last_name FROM students WHERE subject_id = ? AND deleted_at IS NULL',
      [subjectId]
    );
    const seen = new Set(existing.map(fullNameKey));
    const { maxOrder } = db.get(
      'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM students WHERE subject_id = ? AND deleted_at IS NULL',
      [subjectId]
    );
    let order = maxOrder + 1;
    const now = db.now();
    for (const s of groupStudents) {
      if (skipDuplicates && seen.has(fullNameKey(s))) {
        skipped++;
        continue;
      }
      seen.add(fullNameKey(s));
      db.run(
        'INSERT INTO students (id, subject_id, last_name, first_name, middle_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [db.newId(), subjectId, s.last_name, s.first_name, s.middle_name, order++, now, now]
      );
      imported++;
    }
  });
  return { imported, skipped };
}
