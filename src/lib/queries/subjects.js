import db from '@/lib/db';

export async function getAllSubjects() {
  // student_count rides along for the Home list (v1.7.0) — active students
  // only, one correlated subquery (indexed on students.subject_id).
  return db.all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM students st WHERE st.subject_id = s.id AND st.deleted_at IS NULL) AS student_count
    FROM subjects s
    WHERE s.deleted_at IS NULL
    ORDER BY s.created_at DESC`);
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
  // Guarded write (db.updateRow): unchanged values never re-stamp updated_at.
  db.updateRow('subjects', id, {
    name,
    subject_code: String(subject_code || '').trim(),
    section,
    school_year,
    semester,
    prelim_weight,
    midterm_weight,
    final_weight,
  });
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

/**
 * Semester rollover (ROADMAP Phase 3b): a NEW subject for a NEW term,
 * carrying the teaching STRUCTURE and never the term's data.
 *
 *   copied : periods, attendance configs, assessments (name/order/weight),
 *            the exam's one auto-column (the standing invariant)
 *   never  : dated columns (dates belong to the old term) and scores
 *   roster : 'empty' | 'copy' (this subject's students) | 'group' (a
 *            Student Group's members) — fresh UUIDs either way
 *
 * One transaction, ordinary inserts with fresh ids — sync propagates it
 * exactly like any newly created subject; grading_periods' natural keys are
 * fresh because the subject id is.
 */

/**
 * Copy ONE assessment's STRUCTURE into a new period (rollover + duplicate):
 * name/weight/order plus the v1.9.0 workspace configuration travel; the exam
 * invariant (exactly one undated column) and a term-span workspace's three
 * period buckets (source max, no scores) are recreated fresh. Sessions and
 * dated columns never travel — dates belong to the old term.
 */
function copyAssessmentStructure(assessment, newPeriodId, now) {
  const newAssessmentId = db.newId();
  db.run(
    `INSERT INTO assessments (id, period_id, name, is_exam, sort_order, weight_percent, behavior, span, agg_method, agg_max, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newAssessmentId, newPeriodId, assessment.name, assessment.is_exam, assessment.sort_order, assessment.weight_percent,
      assessment.behavior || 'columns', assessment.span || 'period', assessment.agg_method || 'sum', assessment.agg_max ?? null, now, now]
  );
  // The invariant: every exam has exactly one (undated) column.
  if (assessment.is_exam) {
    db.run(
      'INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?)',
      [db.newId(), newAssessmentId, 100, now, now]
    );
  }
  // Term-span workspaces always carry one bucket per grading period.
  if (assessment.behavior === 'workspace' && assessment.span === 'term') {
    const srcBucket = db.get(
      'SELECT max_score FROM assessment_columns WHERE assessment_id = ? AND deleted_at IS NULL AND period_type IS NOT NULL LIMIT 1',
      [assessment.id]
    );
    const types = ['PRELIM', 'MIDTERM', 'FINAL'];
    for (let i = 0; i < types.length; i++) {
      db.run(
        `INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, period_type, label, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, '', ?, ?)`,
        [db.newId(), newAssessmentId, srcBucket?.max_score ?? 100, i, types[i], now, now]
      );
    }
  }
  return newAssessmentId;
}

export async function rolloverSubject(id, {
  name, subject_code = '', section, school_year, semester,
  roster = 'empty', group_id = null,
} = {}) {
  let newSubjectId = null;
  db.transaction(() => {
    const src = db.get('SELECT * FROM subjects WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!src) throw new Error('Subject not found');
    if (!name || !String(name).trim()) throw new Error('A subject name is required');
    const now = db.now();
    newSubjectId = db.newId();
    db.run(
      `INSERT INTO subjects (id, name, subject_code, section, school_year, semester, prelim_weight, midterm_weight, final_weight, owner_device_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newSubjectId, String(name).trim(), String(subject_code || '').trim(), section, school_year, semester,
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
        copyAssessmentStructure(assessment, newPeriodId, now);
      }
    }

    // Roster — fresh student rows (new UUIDs, no scores travel).
    let sourceNames = [];
    if (roster === 'copy') {
      sourceNames = db.all(
        `SELECT last_name, first_name, middle_name, suffix FROM students
          WHERE subject_id = ? AND deleted_at IS NULL
          ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, middle_name COLLATE NOCASE`,
        [id]
      );
    } else if (roster === 'group') {
      if (!group_id) throw new Error('A Student Group is required for the group roster option');
      sourceNames = db.all(
        `SELECT last_name, first_name, middle_name, suffix FROM group_students
          WHERE group_id = ? AND deleted_at IS NULL
          ORDER BY sort_order, last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
        [group_id]
      );
    }
    sourceNames.forEach((s, i) => {
      db.run(
        'INSERT INTO students (id, subject_id, last_name, first_name, middle_name, suffix, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [db.newId(), newSubjectId, s.last_name, s.first_name, s.middle_name || '', s.suffix || '', i, now, now]
      );
    });
  });
  return newSubjectId;
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
        copyAssessmentStructure(assessment, newPeriodId, now);
      }
    }
  });
  return newSubjectId;
}
