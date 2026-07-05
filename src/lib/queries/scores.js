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
