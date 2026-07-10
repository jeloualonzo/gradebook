import db from '@/lib/db';
import { fullNameKey } from './groups';

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
  // Guarded write (db.updateRow): unchanged values never re-stamp updated_at.
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (sort_order !== undefined) fields.sort_order = sort_order;
  if (weight_percent !== undefined) fields.weight_percent = weight_percent;
  if (Object.keys(fields).length === 0) return;
  db.updateRow('assessments', id, fields);
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

export async function updateColumn(id, { date, max_score, attendance_source }) {
  // Guarded write (db.updateRow): the attendance page re-PUTs max_score on
  // EVERY re-save of an existing date — unchanged values must not re-stamp
  // updated_at (that no-op churn produced identical-content conflict entries
  // and could beat a real edit from the other laptop under LWW).
  const fields = {};
  if (date !== undefined) fields.date = date;
  if (max_score !== undefined) fields.max_score = max_score;
  if (attendance_source !== undefined) fields.attendance_source = attendance_source ? 1 : 0;
  if (Object.keys(fields).length === 0) return;
  db.updateRow('assessment_columns', id, fields);
}

/**
 * Move ONE date column — date, max score, attendance flag, and its scores —
 * to another subject (or another period/category of the same subject).
 *
 * Scores travel by student IDENTITY (first + middle + last + suffix,
 * case-insensitive), never by row order: the same person in the destination
 * subject receives the score. Unmatched students are reported; with
 * createMissingStudents they are added to the destination, otherwise their
 * scores are tombstoned along with the move (shown in the preview first).
 *
 * Exams are excluded on both ends (an exam has exactly one column by design).
 * dryRun computes the full match report without changing anything.
 */
export async function moveColumnToSubject(columnId, {
  subjectId, periodType, assessmentName, createMissingStudents = false, dryRun = false,
}) {
  let result = null;
  db.transaction(() => {
    const col = db.get(
      `SELECT c.*, a.name AS assessment_name, a.is_exam, a.period_id, gp.subject_id AS source_subject_id, gp.type AS source_period_type
         FROM assessment_columns c
         JOIN assessments a ON a.id = c.assessment_id
         JOIN grading_periods gp ON gp.id = a.period_id
        WHERE c.id = ? AND c.deleted_at IS NULL`,
      [columnId]
    );
    if (!col) throw new Error('Column not found.');
    if (col.is_exam) throw new Error('Exam columns cannot be moved — an exam always keeps exactly one date.');

    const destPeriod = db.get(
      'SELECT * FROM grading_periods WHERE subject_id = ? AND type = ? AND deleted_at IS NULL',
      [subjectId, periodType]
    );
    if (!destPeriod) throw new Error('The destination grading period was not found.');

    const wantedName = String(assessmentName || col.assessment_name).trim();
    if (!wantedName) throw new Error('An assessment category name is required.');
    if (wantedName.toLowerCase() === 'exam') throw new Error('Columns cannot be moved into an Exam.');
    let destAssessment = db.get(
      'SELECT * FROM assessments WHERE period_id = ? AND deleted_at IS NULL AND is_exam = 0 AND LOWER(name) = LOWER(?)',
      [destPeriod.id, wantedName]
    );
    const willCreateAssessment = !destAssessment;
    if (destAssessment && destAssessment.id === col.assessment_id) {
      throw new Error('That is where this column already is.');
    }

    // Identity matching: source scores → destination students by full name.
    const srcScores = db.all(
      `SELECT sc.id AS score_id, sc.value, st.last_name, st.first_name, st.middle_name, st.suffix
         FROM scores sc JOIN students st ON st.id = sc.student_id
        WHERE sc.column_id = ? AND sc.deleted_at IS NULL AND st.deleted_at IS NULL`,
      [columnId]
    );
    const destStudents = db.all(
      'SELECT * FROM students WHERE subject_id = ? AND deleted_at IS NULL',
      [subjectId]
    );
    const destByKey = new Map(destStudents.map(s => [fullNameKey(s), s]));
    const usedDest = new Set();
    const matched = [];
    const unmatched = [];
    for (const s of srcScores) {
      const dest = destByKey.get(fullNameKey(s));
      if (dest && !usedDest.has(dest.id)) {
        usedDest.add(dest.id);
        matched.push({ score_id: s.score_id, dest_student_id: dest.id });
      } else {
        unmatched.push(s);
      }
    }

    if (dryRun) {
      result = {
        dry_run: true,
        matched: matched.length,
        unmatched: unmatched.map(s => ({ last_name: s.last_name, first_name: s.first_name, middle_name: s.middle_name, suffix: s.suffix })),
        will_create_assessment: willCreateAssessment,
        assessment_name: wantedName,
      };
      return;
    }

    const now = db.now();
    if (!destAssessment) {
      const { cnt } = db.get('SELECT COUNT(*) AS cnt FROM assessments WHERE period_id = ? AND deleted_at IS NULL', [destPeriod.id]);
      const newId = db.newId();
      db.run(
        'INSERT INTO assessments (id, period_id, name, is_exam, sort_order, weight_percent, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 0, ?, ?)',
        [newId, destPeriod.id, wantedName, cnt, now, now]
      );
      normalizeExamLastSync(destPeriod.id); // the exam stays last
      destAssessment = { id: newId };
    }

    let createdStudents = 0;
    if (createMissingStudents && unmatched.length) {
      let { maxOrder } = db.get('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM students WHERE subject_id = ? AND deleted_at IS NULL', [subjectId]);
      for (const s of unmatched.splice(0)) {
        const sid = db.newId();
        db.run(
          'INSERT INTO students (id, subject_id, last_name, first_name, middle_name, suffix, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [sid, subjectId, s.last_name, s.first_name, s.middle_name || '', s.suffix || '', ++maxOrder, now, now]
        );
        matched.push({ score_id: s.score_id, dest_student_id: sid });
        createdStudents++;
      }
    }

    // Move the column itself (date, max score, attendance flag ride along).
    const { cnt: destColCount } = db.get('SELECT COUNT(*) AS cnt FROM assessment_columns WHERE assessment_id = ? AND deleted_at IS NULL', [destAssessment.id]);
    db.run('UPDATE assessment_columns SET assessment_id = ?, sort_order = ?, updated_at = ? WHERE id = ?', [destAssessment.id, destColCount, now, columnId]);

    // Re-point matched scores to the destination students…
    for (const m of matched) {
      db.run('UPDATE scores SET student_id = ?, updated_at = ? WHERE id = ?', [m.dest_student_id, now, m.score_id]);
    }
    // …and tombstone the scores that could not travel.
    for (const s of unmatched) {
      db.run('UPDATE scores SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, s.score_id]);
    }

    result = {
      moved: true,
      matched: matched.length,
      unmatched: unmatched.map(s => ({ last_name: s.last_name, first_name: s.first_name, middle_name: s.middle_name, suffix: s.suffix })),
      created_students: createdStudents,
      created_assessment: willCreateAssessment ? wantedName : null,
    };
  });
  return result;
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
  // No-op guard (see db.updateRow): re-saving the same config — the settings
  // form always submits on Save — must not re-stamp updated_at.
  const existing = db.get('SELECT * FROM attendance_config WHERE period_id = ?', [periodId]);
  if (
    existing && !existing.deleted_at &&
    db.valuesEqual(existing.present_score, present_score) &&
    db.valuesEqual(existing.late_score, late_score) &&
    db.valuesEqual(existing.absent_score, absent_score)
  ) {
    return;
  }
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
