import pool from '@/lib/db';

export async function getStudentsBySubject(subjectId) {
  // Students are ALWAYS presented alphabetically (last, first, middle name)
  // everywhere in the app so instructors can locate them instantly.
  const [rows] = await pool.query(
    'SELECT * FROM students WHERE subject_id = ? ORDER BY last_name, first_name, middle_name',
    [subjectId]
  );
  return rows;
}

export async function createStudent(subjectId, { last_name, first_name, middle_name = '' }) {
  const [[{ maxOrder }]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) as maxOrder FROM students WHERE subject_id = ?',
    [subjectId]
  );
  const [result] = await pool.query(
    'INSERT INTO students (subject_id, last_name, first_name, middle_name, sort_order) VALUES (?, ?, ?, ?, ?)',
    [subjectId, last_name, first_name, middle_name, maxOrder + 1]
  );
  return result.insertId;
}

export async function updateStudent(id, { last_name, first_name, middle_name = '' }) {
  await pool.query(
    'UPDATE students SET last_name=?, first_name=?, middle_name=? WHERE id=?',
    [last_name, first_name, middle_name, id]
  );
}

export async function deleteStudent(id) {
  await pool.query('DELETE FROM students WHERE id = ?', [id]);
}

export async function reorderStudents(orderedIds) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.query('UPDATE students SET sort_order = ? WHERE id = ?', [i, orderedIds[i]]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
