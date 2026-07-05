import pool from '@/lib/db';

export async function getPeriodsBySubject(subjectId) {
  const [periods] = await pool.query(
    'SELECT * FROM grading_periods WHERE subject_id = ? ORDER BY FIELD(type, "PRELIM", "MIDTERM", "FINAL")',
    [subjectId]
  );
  return periods;
}

export async function createPeriod(subjectId, type) {
  const [result] = await pool.query(
    'INSERT INTO grading_periods (subject_id, type) VALUES (?, ?)',
    [subjectId, type]
  );
  return result.insertId;
}

export async function getAssessmentsByPeriod(periodId) {
  const [rows] = await pool.query(
    'SELECT * FROM assessments WHERE period_id = ? ORDER BY sort_order',
    [periodId]
  );
  return rows;
}

export async function createAssessment(periodId, { name, is_exam = 0, sort_order = 0, weight_percent = 0 }) {
  const [result] = await pool.query(
    'INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, ?, ?, ?, ?)',
    [periodId, name, is_exam, sort_order, weight_percent]
  );
  return result.insertId;
}

export async function updateAssessment(id, { name, sort_order, weight_percent }) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
  if (weight_percent !== undefined) { fields.push('weight_percent = ?'); values.push(weight_percent); }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE assessments SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteAssessment(id) {
  await pool.query('DELETE FROM assessments WHERE id = ?', [id]);
}

export async function reorderAssessments(orderedIds) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.query('UPDATE assessments SET sort_order = ? WHERE id = ?', [i, orderedIds[i]]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getColumnsByAssessment(assessmentId) {
  const [rows] = await pool.query(
    'SELECT * FROM assessment_columns WHERE assessment_id = ? ORDER BY date, sort_order',
    [assessmentId]
  );
  return rows;
}

export async function createColumn(assessmentId, { date = null, max_score = 100 }) {
  const [[{ cnt }]] = await pool.query(
    'SELECT COUNT(*) as cnt FROM assessment_columns WHERE assessment_id = ?',
    [assessmentId]
  );
  const [result] = await pool.query(
    'INSERT INTO assessment_columns (assessment_id, date, max_score, sort_order) VALUES (?, ?, ?, ?)',
    [assessmentId, date, max_score, cnt]
  );
  return result.insertId;
}

export async function updateColumn(id, { date, max_score }) {
  const fields = [];
  const values = [];
  if (date !== undefined) { fields.push('date = ?'); values.push(date); }
  if (max_score !== undefined) { fields.push('max_score = ?'); values.push(max_score); }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE assessment_columns SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteColumn(id) {
  await pool.query('DELETE FROM assessment_columns WHERE id = ?', [id]);
}

export async function getAttendanceConfig(periodId) {
  const [rows] = await pool.query('SELECT * FROM attendance_config WHERE period_id = ?', [periodId]);
  return rows[0] || null;
}

export async function upsertAttendanceConfig(periodId, { present_score, late_score, absent_score }) {
  await pool.query(
    `INSERT INTO attendance_config (period_id, present_score, late_score, absent_score)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE present_score=VALUES(present_score), late_score=VALUES(late_score), absent_score=VALUES(absent_score)`,
    [periodId, present_score, late_score, absent_score]
  );
}
