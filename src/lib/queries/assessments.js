import db from '@/lib/db';

const PERIOD_ORDER = "CASE type WHEN 'PRELIM' THEN 0 WHEN 'MIDTERM' THEN 1 ELSE 2 END";

export async function getPeriodsBySubject(subjectId) {
  return db.all(
    `SELECT * FROM grading_periods
     WHERE subject_id = ? AND deleted_at IS NULL
     ORDER BY ${PERIOD_ORDER}`,
    [subjectId]
  );
}

export async function createPeriod(subjectId, type) {
  const id = db.newId();
  const now = db.now();
  db.run(
    'INSERT INTO grading_periods (id, subject_id, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, subjectId, type, now, now]
  );
  return id;
}

export async function getAssessmentsByPeriod(periodId) {
  // Exams ALWAYS sort last within their grading period.
  return db.all(
    'SELECT * FROM assessments WHERE period_id = ? AND deleted_at IS NULL ORDER BY is_exam, sort_order',
    [periodId]
  );
}

// Re-number sort_order so non-exams keep relative order and exams stay last.
// Only rows whose position actually changes are touched (keeps sync churn low).
function normalizeExamLastSync(periodId) {
  const rows = db.all(
    'SELECT id, sort_order FROM assessments WHERE period_id = ? AND deleted_at IS NULL ORDER BY is_exam, sort_order',
    [periodId]
  );
  const now = db.now();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sort_order !== i) {
      db.run('UPDATE assessments SET sort_order=?, updated_at=? WHERE id=?', [i, now, rows[i].id]);
    }
  }
}

export async function normalizeExamLast(periodId) {
  db.transaction(() => normalizeExamLastSync(periodId));
}

export async function createAssessment(periodId, { name, is_exam = 0, sort_order = 0, weight_percent = 0, skip_auto_column = false }) {
  const id = db.newId();
  const now = db.now();
  db.transaction(() => {
    db.run(
      `INSERT INTO assessments (id, period_id, name, is_exam, sort_order, weight_percent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, periodId, name, is_exam ? 1 : 0, sort_order, weight_percent, now, now]
    );
    // Every exam automatically gets exactly one date column (date is picked
    // by the instructor later; it shows as "--" until then).
    if (is_exam && !skip_auto_column) {
      db.run(
        `INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 0, ?, ?)`,
        [db.newId(), id, 100, now, now]
      );
    }
  });
  return id;
}

export async function updateAssessment(id, { name, sort_order, weight_percent }) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
  if (weight_percent !== undefined) { fields.push('weight_percent = ?'); values.push(weight_percent); }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(db.now(), id);
  db.run(`UPDATE assessments SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteAssessment(id) {
  // Cascade tombstone: assessment + its columns + their scores.
  const now = db.now();
  db.transaction(() => {
    db.run(
      `UPDATE scores SET deleted_at=?, updated_at=?
       WHERE deleted_at IS NULL AND column_id IN (SELECT id FROM assessment_columns WHERE assessment_id = ?)`,
      [now, now, id]
    );
    db.run(
      'UPDATE assessment_columns SET deleted_at=?, updated_at=? WHERE assessment_id=? AND deleted_at IS NULL',
      [now, now, id]
    );
    db.run('UPDATE assessments SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [now, now, id]);
  });
}

export async function reorderAssessments(orderedIds) {
  if (!orderedIds || orderedIds.length === 0) return;
  db.transaction(() => {
    const now = db.now();
    for (let i = 0; i < orderedIds.length; i++) {
      db.run(
        'UPDATE assessments SET sort_order=?, updated_at=? WHERE id=? AND sort_order != ?',
        [i, now, orderedIds[i], i]
      );
    }
    // Enforce exam-last within the affected period, no matter what order the
    // client sent (a drop past the exam lands immediately above it).
    const row = db.get('SELECT period_id FROM assessments WHERE id = ?', [orderedIds[0]]);
    if (row) normalizeExamLastSync(row.period_id);
  });
}

export async function getColumnsByAssessment(assessmentId) {
  // Dated columns sort chronologically (earliest → latest); columns without a
  // date yet (newly added) always come LAST, so new columns append at the end
  // and snap into chronological position once a date is assigned.
  return db.all(
    `SELECT * FROM assessment_columns
     WHERE assessment_id = ? AND deleted_at IS NULL
     ORDER BY (date IS NULL), date, sort_order`,
    [assessmentId]
  );
}

export async function createColumn(assessmentId, { date = null, max_score = 100, dedupe_by_date = false }) {
  // Used by Quick Attendance: never create a second column for the same
  // date — reuse the existing one instead.
  if (dedupe_by_date && date) {
    const existing = db.get(
      'SELECT id FROM assessment_columns WHERE assessment_id = ? AND date = ? AND deleted_at IS NULL LIMIT 1',
      [assessmentId, date]
    );
    if (existing) return existing.id;
  }
  const { cnt } = db.get(
    'SELECT COUNT(*) as cnt FROM assessment_columns WHERE assessment_id = ? AND deleted_at IS NULL',
    [assessmentId]
  );
  const id = db.newId();
  const now = db.now();
  db.run(
    `INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, assessmentId, date, max_score, cnt, now, now]
  );
  return id;
}

export async function updateColumn(id, { date, max_score }) {
  const fields = [];
  const values = [];
  if (date !== undefined) { fields.push('date = ?'); values.push(date); }
  if (max_score !== undefined) { fields.push('max_score = ?'); values.push(max_score); }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(db.now(), id);
  db.run(`UPDATE assessment_columns SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteColumn(id) {
  // Cascade tombstone: column + its scores.
  const now = db.now();
  db.transaction(() => {
    db.run('UPDATE scores SET deleted_at=?, updated_at=? WHERE column_id=? AND deleted_at IS NULL', [now, now, id]);
    db.run('UPDATE assessment_columns SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [now, now, id]);
  });
}

export async function getAttendanceConfig(periodId) {
  return db.get('SELECT * FROM attendance_config WHERE period_id = ? AND deleted_at IS NULL', [periodId]) || null;
}

export async function upsertAttendanceConfig(periodId, { present_score, late_score, absent_score }) {
  const now = db.now();
  db.run(
    `INSERT INTO attendance_config (id, period_id, present_score, late_score, absent_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_id)
     DO UPDATE SET present_score=excluded.present_score, late_score=excluded.late_score,
                   absent_score=excluded.absent_score, updated_at=excluded.updated_at, deleted_at=NULL`,
    [db.newId(), periodId, present_score, late_score, absent_score, now, now]
  );
}
