import pool from '@/lib/db';

export async function getScoresBySubject(subjectId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.column_id, s.student_id, s.value
     FROM scores s
     JOIN assessment_columns ac ON ac.id = s.column_id
     JOIN assessments a ON a.id = ac.assessment_id
     JOIN grading_periods gp ON gp.id = a.period_id
     WHERE gp.subject_id = ?`,
    [subjectId]
  );
  return rows;
}

export async function upsertScore(columnId, studentId, value) {
  if (value === null || value === undefined || value === '') {
    await pool.query(
      'DELETE FROM scores WHERE column_id = ? AND student_id = ?',
      [columnId, studentId]
    );
    return;
  }
  await pool.query(
    `INSERT INTO scores (column_id, student_id, value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [columnId, studentId, value]
  );
}

export async function bulkUpsertScores(entries) {
  if (!entries || entries.length === 0) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { column_id, student_id, value } of entries) {
      if (value === null || value === undefined || value === '') {
        await conn.query('DELETE FROM scores WHERE column_id = ? AND student_id = ?', [column_id, student_id]);
      } else {
        await conn.query(
          `INSERT INTO scores (column_id, student_id, value) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [column_id, student_id, value]
        );
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
