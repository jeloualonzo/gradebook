import db from '@/lib/db';

export async function getAllSubjects() {
  return db.all('SELECT * FROM subjects WHERE deleted_at IS NULL ORDER BY created_at DESC');
}

export async function getSubjectById(id) {
  return db.get('SELECT * FROM subjects WHERE id = ? AND deleted_at IS NULL', [id]) || null;
}

export async function createSubject({ name, subject_code = '', section, school_year, semester, prelim_weight = 30, midterm_weight = 30, final_weight = 40 }) {
  const id = db.newId();
  const now = db.now();
  db.run(
    `INSERT INTO subjects (id, name, subject_code, section, school_year, semester, prelim_weight, midterm_weight, final_weight, owner_device_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, String(subject_code || '').trim(), section, school_year, semester, prelim_weight, midterm_weight, final_weight, db.getDeviceId(), now, now]
  );
  return id;
}

export async function updateSubject(id, { name, subject_code = '', section, school_year, semester, prelim_weight, midterm_weight, final_weight }) {
  db.run(
    `UPDATE subjects SET name=?, subject_code=?, section=?, school_year=?, semester=?, prelim_weight=?, midterm_weight=?, final_weight=?, updated_at=?
     WHERE id=?`,
    [name, String(subject_code || '').trim(), section, school_year, semester, prelim_weight, midterm_weight, final_weight, db.now(), id]
  );
}

export async function deleteSubject(id) {
  // Cascade tombstone the whole subject tree so the deletion syncs cleanly.
  const now = db.now();
  db.transaction(() => {
    db.run(
      `UPDATE scores SET deleted_at=?, updated_at=?
       WHERE deleted_at IS NULL AND student_id IN (SELECT id FROM students WHERE subject_id = ?)`,
      [now, now, id]
    );
    db.run('UPDATE students SET deleted_at=?, updated_at=? WHERE subject_id=? AND deleted_at IS NULL', [now, now, id]);
    db.run(
      `UPDATE attendance_config SET deleted_at=?, updated_at=?
       WHERE deleted_at IS NULL AND period_id IN (SELECT id FROM grading_periods WHERE subject_id = ?)`,
      [now, now, id]
    );
    db.run(
      `UPDATE assessment_columns SET deleted_at=?, updated_at=?
       WHERE deleted_at IS NULL AND assessment_id IN (
         SELECT a.id FROM assessments a
         JOIN grading_periods gp ON gp.id = a.period_id
         WHERE gp.subject_id = ?
       )`,
      [now, now, id]
    );
    db.run(
      `UPDATE assessments SET deleted_at=?, updated_at=?
       WHERE deleted_at IS NULL AND period_id IN (SELECT id FROM grading_periods WHERE subject_id = ?)`,
      [now, now, id]
    );
    db.run('UPDATE grading_periods SET deleted_at=?, updated_at=? WHERE subject_id=? AND deleted_at IS NULL', [now, now, id]);
    db.run(
      'UPDATE subjects SET deleted_at=?, updated_at=?, deleted_by_device_id=? WHERE id=? AND deleted_at IS NULL',
      [now, now, db.getDeviceId(), id]
    );
  });
}

/** Recycle bin: tombstoned subjects that were not permanently deleted. */
export async function getDeletedSubjects() {
  return db.all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM students st WHERE st.subject_id = s.id AND st.deleted_at = s.deleted_at) AS student_count,
      (SELECT COUNT(*) FROM scores sc
        WHERE sc.deleted_at = s.deleted_at
          AND sc.student_id IN (SELECT id FROM students WHERE subject_id = s.id)) AS score_count
    FROM subjects s
    WHERE s.deleted_at IS NOT NULL AND s.purged_at IS NULL
    ORDER BY s.deleted_at DESC`);
}

/**
 * Restore a deleted subject with everything that died WITH it: the cascade
 * stamped the whole tree with one shared deleted_at, so reviving exactly
 * that timestamp brings back students/assessments/columns/scores/attendance
 * while anything deleted EARLIER (separately, on purpose) stays deleted.
 * Fresh updated_at values make the revival win over peer tombstones in sync.
 */
export async function restoreSubject(id) {
  db.transaction(() => {
    const row = db.get('SELECT * FROM subjects WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!row) throw new Error('This subject is not in the recycle bin.');
    const ts = row.deleted_at;
    const now = db.now();
    db.run(
      `UPDATE scores SET deleted_at=NULL, updated_at=?
       WHERE deleted_at = ? AND student_id IN (SELECT id FROM students WHERE subject_id = ?)`,
      [now, ts, id]
    );
    db.run('UPDATE students SET deleted_at=NULL, updated_at=? WHERE subject_id=? AND deleted_at = ?', [now, id, ts]);
    db.run(
      `UPDATE attendance_config SET deleted_at=NULL, updated_at=?
       WHERE deleted_at = ? AND period_id IN (SELECT id FROM grading_periods WHERE subject_id = ?)`,
      [now, ts, id]
    );
    db.run(
      `UPDATE assessment_columns SET deleted_at=NULL, updated_at=?
       WHERE deleted_at = ? AND assessment_id IN (
         SELECT a.id FROM assessments a
         JOIN grading_periods gp ON gp.id = a.period_id
         WHERE gp.subject_id = ?
       )`,
      [now, ts, id]
    );
    db.run(
      `UPDATE assessments SET deleted_at=NULL, updated_at=?
       WHERE deleted_at = ? AND period_id IN (SELECT id FROM grading_periods WHERE subject_id = ?)`,
      [now, ts, id]
    );
    db.run('UPDATE grading_periods SET deleted_at=NULL, updated_at=? WHERE subject_id=? AND deleted_at = ?', [now, id, ts]);
    db.run('UPDATE subjects SET deleted_at=NULL, purged_at=NULL, deleted_by_device_id=NULL, updated_at=? WHERE id=?', [now, id]);
  });
}

/**
 * Permanently delete: the row STAYS a synced tombstone (hard-deleting rows
 * would let old snapshots resurrect them) but is hidden from the recycle
 * bin everywhere — purged_at syncs like any other edit.
 */
export async function purgeSubject(id) {
  const now = db.now();
  const info = db.run(
    'UPDATE subjects SET purged_at=?, updated_at=? WHERE id=? AND deleted_at IS NOT NULL',
    [now, now, id]
  );
  if (info.changes === 0) throw new Error('This subject is not in the recycle bin.');
}

export async function duplicateSubject(id) {
  let newSubjectId = null;
  db.transaction(() => {
    const src = db.get('SELECT * FROM subjects WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!src) throw new Error('Subject not found');
    const now = db.now();
    newSubjectId = db.newId();
    db.run(
      `INSERT INTO subjects (id, name, section, school_year, semester, prelim_weight, midterm_weight, final_weight, owner_device_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newSubjectId, `${src.name} (Copy)`, src.section, src.school_year, src.semester,
        src.prelim_weight, src.midterm_weight, src.final_weight, db.getDeviceId(), now, now]
    );

    const periods = db.all('SELECT * FROM grading_periods WHERE subject_id = ? AND deleted_at IS NULL', [id]);
    for (const period of periods) {
      const newPeriodId = db.newId();
      db.run(
        'INSERT INTO grading_periods (id, subject_id, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [newPeriodId, newSubjectId, period.type, now, now]
      );

      const ac = db.get('SELECT * FROM attendance_config WHERE period_id = ? AND deleted_at IS NULL', [period.id]);
      if (ac) {
        db.run(
          'INSERT INTO attendance_config (id, period_id, present_score, late_score, absent_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [db.newId(), newPeriodId, ac.present_score, ac.late_score, ac.absent_score, now, now]
        );
      }

      const assessments = db.all(
        'SELECT * FROM assessments WHERE period_id = ? AND deleted_at IS NULL ORDER BY is_exam, sort_order',
        [period.id]
      );
      for (const assessment of assessments) {
        const newAssessmentId = db.newId();
        db.run(
          'INSERT INTO assessments (id, period_id, name, is_exam, sort_order, weight_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [newAssessmentId, newPeriodId, assessment.name, assessment.is_exam, assessment.sort_order, assessment.weight_percent, now, now]
        );
        // Keep the invariant: every exam has exactly one date column.
        if (assessment.is_exam) {
          db.run(
            'INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?)',
            [db.newId(), newAssessmentId, 100, now, now]
          );
        }
      }
    }
  });
  return newSubjectId;
}
