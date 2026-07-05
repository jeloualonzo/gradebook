import pool from '@/lib/db';

export async function getAllSubjects() {
  const [rows] = await pool.query(
    'SELECT * FROM subjects ORDER BY created_at DESC'
  );
  return rows;
}

export async function getSubjectById(id) {
  const [rows] = await pool.query('SELECT * FROM subjects WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function createSubject({ name, section, school_year, semester, prelim_weight = 30, midterm_weight = 30, final_weight = 40 }) {
  const [result] = await pool.query(
    `INSERT INTO subjects (name, section, school_year, semester, prelim_weight, midterm_weight, final_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, section, school_year, semester, prelim_weight, midterm_weight, final_weight]
  );
  return result.insertId;
}

export async function updateSubject(id, { name, section, school_year, semester, prelim_weight, midterm_weight, final_weight }) {
  await pool.query(
    `UPDATE subjects SET name=?, section=?, school_year=?, semester=?, prelim_weight=?, midterm_weight=?, final_weight=?
     WHERE id=?`,
    [name, section, school_year, semester, prelim_weight, midterm_weight, final_weight, id]
  );
}

export async function deleteSubject(id) {
  await pool.query('DELETE FROM subjects WHERE id = ?', [id]);
}

export async function duplicateSubject(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[src]] = await conn.query('SELECT * FROM subjects WHERE id = ?', [id]);
    const [subjectResult] = await conn.query(
      `INSERT INTO subjects (name, section, school_year, semester, prelim_weight, midterm_weight, final_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`${src.name} (Copy)`, src.section, src.school_year, src.semester, src.prelim_weight, src.midterm_weight, src.final_weight]
    );
    const newSubjectId = subjectResult.insertId;

    const [periods] = await conn.query('SELECT * FROM grading_periods WHERE subject_id = ?', [id]);
    for (const period of periods) {
      const [periodResult] = await conn.query(
        'INSERT INTO grading_periods (subject_id, type) VALUES (?, ?)',
        [newSubjectId, period.type]
      );
      const newPeriodId = periodResult.insertId;

      const [attConfigs] = await conn.query('SELECT * FROM attendance_config WHERE period_id = ?', [period.id]);
      if (attConfigs.length > 0) {
        const ac = attConfigs[0];
        await conn.query(
          'INSERT INTO attendance_config (period_id, present_score, late_score, absent_score) VALUES (?, ?, ?, ?)',
          [newPeriodId, ac.present_score, ac.late_score, ac.absent_score]
        );
      }

      const [assessments] = await conn.query('SELECT * FROM assessments WHERE period_id = ? ORDER BY sort_order', [period.id]);
      for (const assessment of assessments) {
        await conn.query(
          'INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, ?, ?, ?, ?)',
          [newPeriodId, assessment.name, assessment.is_exam, assessment.sort_order, assessment.weight_percent]
        );
      }
    }

    await conn.commit();
    return newSubjectId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
