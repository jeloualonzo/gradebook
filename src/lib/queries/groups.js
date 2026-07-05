import pool from '@/lib/db';

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
  const [rows] = await pool.query(
    `SELECT g.*, COUNT(gs.id) AS student_count
     FROM student_groups g
     LEFT JOIN group_students gs ON gs.group_id = g.id
     GROUP BY g.id
     ORDER BY g.created_at DESC`
  );
  return rows;
}

export async function getGroupById(id) {
  const [rows] = await pool.query('SELECT * FROM student_groups WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function createGroup({ name, description = '' }) {
  const [result] = await pool.query(
    'INSERT INTO student_groups (name, description) VALUES (?, ?)',
    [name, description || '']
  );
  return result.insertId;
}

export async function updateGroup(id, { name, description = '' }) {
  await pool.query(
    'UPDATE student_groups SET name = ?, description = ? WHERE id = ?',
    [name, description || '', id]
  );
}

export async function deleteGroup(id) {
  await pool.query('DELETE FROM student_groups WHERE id = ?', [id]);
}

export async function duplicateGroup(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[src]] = await conn.query('SELECT * FROM student_groups WHERE id = ?', [id]);
    if (!src) throw new Error('Group not found');
    const [groupResult] = await conn.query(
      'INSERT INTO student_groups (name, description) VALUES (?, ?)',
      [`${src.name} (Copy)`, src.description]
    );
    const newGroupId = groupResult.insertId;
    const [students] = await conn.query(
      'SELECT * FROM group_students WHERE group_id = ? ORDER BY sort_order, last_name, first_name',
      [id]
    );
    for (const s of students) {
      await conn.query(
        'INSERT INTO group_students (group_id, last_name, first_name, middle_name, sort_order) VALUES (?, ?, ?, ?, ?)',
        [newGroupId, s.last_name, s.first_name, s.middle_name, s.sort_order]
      );
    }
    await conn.commit();
    return newGroupId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getGroupStudents(groupId) {
  const [rows] = await pool.query(
    'SELECT * FROM group_students WHERE group_id = ? ORDER BY sort_order, last_name, first_name',
    [groupId]
  );
  return rows;
}

export async function createGroupStudent(groupId, { last_name, first_name, middle_name = '' }) {
  const [[{ maxOrder }]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM group_students WHERE group_id = ?',
    [groupId]
  );
  const [result] = await pool.query(
    'INSERT INTO group_students (group_id, last_name, first_name, middle_name, sort_order) VALUES (?, ?, ?, ?, ?)',
    [groupId, last_name, first_name, middle_name || '', maxOrder + 1]
  );
  return result.insertId;
}

export async function updateGroupStudent(id, { last_name, first_name, middle_name = '' }) {
  await pool.query(
    'UPDATE group_students SET last_name=?, first_name=?, middle_name=? WHERE id=?',
    [last_name, first_name, middle_name || '', id]
  );
}

export async function deleteGroupStudent(id) {
  await pool.query('DELETE FROM group_students WHERE id = ?', [id]);
}

export async function reorderGroupStudents(orderedIds) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.query('UPDATE group_students SET sort_order = ? WHERE id = ?', [i, orderedIds[i]]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Bulk-add students to a group (used by Excel import).
 * Never creates duplicates within the group: rows whose full name
 * (first + middle + last, case-insensitive, trimmed) already exists in the
 * group — or appears twice in the payload — are skipped.
 * Returns { added, skipped }.
 */
export async function bulkAddGroupStudents(groupId, students) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      'SELECT first_name, middle_name, last_name FROM group_students WHERE group_id = ?',
      [groupId]
    );
    const seen = new Set(existing.map(fullNameKey));
    const [[{ maxOrder }]] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM group_students WHERE group_id = ?',
      [groupId]
    );
    let order = maxOrder + 1;
    let added = 0;
    let skipped = 0;
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
      await conn.query(
        'INSERT INTO group_students (group_id, last_name, first_name, middle_name, sort_order) VALUES (?, ?, ?, ?, ?)',
        [groupId, student.last_name, student.first_name, student.middle_name, order++]
      );
      added++;
    }
    await conn.commit();
    return { added, skipped };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * One-time COPY of a group's students into a subject. New students are
 * appended after the subject's existing list; existing grades are untouched.
 * When skipDuplicates is true, students whose full name already exists in
 * the subject are skipped.
 * Returns { imported, skipped }.
 */
export async function importGroupIntoSubject(subjectId, groupId, { skipDuplicates = false } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [groupStudents] = await conn.query(
      'SELECT * FROM group_students WHERE group_id = ? ORDER BY sort_order, last_name, first_name',
      [groupId]
    );
    const [existing] = await conn.query(
      'SELECT first_name, middle_name, last_name FROM students WHERE subject_id = ?',
      [subjectId]
    );
    const seen = new Set(existing.map(fullNameKey));
    const [[{ maxOrder }]] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM students WHERE subject_id = ?',
      [subjectId]
    );
    let order = maxOrder + 1;
    let imported = 0;
    let skipped = 0;
    for (const s of groupStudents) {
      if (skipDuplicates && seen.has(fullNameKey(s))) {
        skipped++;
        continue;
      }
      seen.add(fullNameKey(s));
      await conn.query(
        'INSERT INTO students (subject_id, last_name, first_name, middle_name, sort_order) VALUES (?, ?, ?, ?, ?)',
        [subjectId, s.last_name, s.first_name, s.middle_name, order++]
      );
      imported++;
    }
    await conn.commit();
    return { imported, skipped };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
