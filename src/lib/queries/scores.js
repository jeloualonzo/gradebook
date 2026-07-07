import db from '@/lib/db';

export async function getScoresBySubject(subjectId) {
  return db.all(
    `SELECT s.id, s.column_id, s.student_id, s.value
     FROM scores s
     JOIN assessment_columns ac ON ac.id = s.column_id
     JOIN assessments a ON a.id = ac.assessment_id
     JOIN grading_periods gp ON gp.id = a.period_id
     WHERE gp.subject_id = ? AND s.deleted_at IS NULL`,
    [subjectId]
  );
}

// Clearing a score tombstones the row (so the deletion syncs); setting a
// value inserts or REVIVES the row for that (column, student) pair.
function upsertOne(columnId, studentId, value) {
  const now = db.now();
  if (value === null || value === undefined || value === '') {
    db.run(
      'UPDATE scores SET value=NULL, deleted_at=?, updated_at=? WHERE column_id=? AND student_id=? AND deleted_at IS NULL',
      [now, now, columnId, studentId]
    );
    return;
  }
  db.run(
    `INSERT INTO scores (id, column_id, student_id, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(column_id, student_id)
     DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, deleted_at=NULL`,
    [db.newId(), columnId, studentId, value, now, now]
  );
}

export async function upsertScore(columnId, studentId, value) {
  upsertOne(columnId, studentId, value);
}

export async function bulkUpsertScores(entries) {
  if (!entries || entries.length === 0) return;
  db.transaction(() => {
    for (const { column_id, student_id, value } of entries) {
      upsertOne(column_id, student_id, value);
    }
  });
}

/**
 * Attendance source hook — called AFTER a real score is saved on a column.
 *
 * If the column is marked "counts as attendance" (attendance_source) and has
 * a date, the student is automatically marked Present in the period's
 * Attendance assessment for that same date:
 *   · the Attendance column with the same date is REUSED if it exists,
 *     created otherwise (max = the period's configured Present score);
 *   · the Present score is written ONLY when the student's attendance for
 *     that date is blank — an existing value (Late, Absent, anything) is
 *     never overwritten;
 *   · students with no score stay blank (never auto-marked Absent).
 */
export async function applyAttendanceSource(columnId, studentId) {
  db.transaction(() => {
    const col = db.get(
      `SELECT c.id, c.date, c.attendance_source, a.period_id, a.name AS assessment_name
         FROM assessment_columns c
         JOIN assessments a ON a.id = c.assessment_id
        WHERE c.id = ? AND c.deleted_at IS NULL`,
      [columnId]
    );
    if (!col || !col.attendance_source || !col.date) return;
    if (String(col.assessment_name).toLowerCase() === 'attendance') return; // never self-feed

    const attendance = db.get(
      `SELECT id FROM assessments
        WHERE period_id = ? AND deleted_at IS NULL AND is_exam = 0 AND LOWER(name) = 'attendance'
        LIMIT 1`,
      [col.period_id]
    );
    if (!attendance) return; // this period has no Attendance category

    const cfg = db.get(
      'SELECT present_score FROM attendance_config WHERE period_id = ? AND deleted_at IS NULL',
      [col.period_id]
    );
    const present = cfg?.present_score ?? 10;

    // Same-date attendance column: reuse, else create.
    let attCol = db.get(
      'SELECT id FROM assessment_columns WHERE assessment_id = ? AND date = ? AND deleted_at IS NULL LIMIT 1',
      [attendance.id, col.date]
    );
    if (!attCol) {
      const now = db.now();
      const { cnt } = db.get('SELECT COUNT(*) AS cnt FROM assessment_columns WHERE assessment_id = ? AND deleted_at IS NULL', [attendance.id]);
      const newId = db.newId();
      db.run(
        'INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newId, attendance.id, col.date, present, cnt, now, now]
      );
      attCol = { id: newId };
    }

    // Fill ONLY blanks — never overwrite an existing attendance value.
    const existing = db.get(
      'SELECT id FROM scores WHERE column_id = ? AND student_id = ? AND deleted_at IS NULL',
      [attCol.id, studentId]
    );
    if (existing) return;
    upsertOne(attCol.id, studentId, present);
  });
}
