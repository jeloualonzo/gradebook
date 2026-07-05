/**
 * One-time data migration: MySQL → SQLite.
 *
 * Reads your existing MySQL gradebook (using the same DB_* environment
 * variables the old setup used) and writes it into the new zero-config
 * SQLite database (./data/gradebook.sqlite), converting integer ids to
 * UUIDs while preserving every relationship.
 *
 * Usage:
 *   DB_HOST=localhost DB_PORT=3307 DB_NAME=gradebook DB_USER=... DB_PASSWORD=... \
 *     npm run migrate:from-mysql
 *
 * Safe by design: refuses to run if the SQLite database already contains
 * data (pass --force to merge into it anyway).
 */

import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FORCE = process.argv.includes('--force');

// ---- Open (and bootstrap) the SQLite target --------------------------------
const dataDir = process.env.GRADEBOOK_DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const sqlite = new Database(path.join(dataDir, 'gradebook.sqlite'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const { SCHEMA_SQL } = await import(path.join(process.cwd(), 'src/lib/schema.mjs'));
sqlite.exec(SCHEMA_SQL);
if (sqlite.pragma('user_version', { simple: true }) < 1) sqlite.pragma('user_version = 1');

// Device identity (same file the app uses).
const devicePath = path.join(dataDir, 'device.json');
let device;
try {
  device = JSON.parse(fs.readFileSync(devicePath, 'utf8'));
  if (!device?.device_id) throw new Error('invalid');
} catch {
  device = { device_id: crypto.randomUUID(), device_label: null };
  fs.writeFileSync(devicePath, JSON.stringify(device, null, 2));
}

const existing = sqlite.prepare('SELECT COUNT(*) AS c FROM subjects').get().c
  + sqlite.prepare('SELECT COUNT(*) AS c FROM student_groups').get().c;
if (existing > 0 && !FORCE) {
  console.error(
    `The SQLite database already contains data (${existing} subjects/groups).\n` +
    'Refusing to migrate on top of it. Re-run with --force to merge anyway.'
  );
  process.exit(1);
}

// ---- Read everything from MySQL --------------------------------------------
const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3307', 10),
  database: process.env.DB_NAME || 'gradebook',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  dateStrings: true, // calendar dates come over as plain strings — no TZ shifts
});

const read = async (table) => {
  try {
    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    return rows;
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return []; // older DB without groups
    throw err;
  }
};

const src = {
  subjects: await read('subjects'),
  students: await read('students'),
  grading_periods: await read('grading_periods'),
  assessments: await read('assessments'),
  assessment_columns: await read('assessment_columns'),
  scores: await read('scores'),
  attendance_config: await read('attendance_config'),
  student_groups: await read('student_groups'),
  group_students: await read('group_students'),
};
await conn.end();

// ---- Convert: int ids → UUIDs, preserving every foreign key ----------------
const now = new Date().toISOString();
const toISO = (v) => {
  if (!v) return now;
  const d = new Date(v);
  return isNaN(d.getTime()) ? now : d.toISOString();
};
const idMap = (rows) => new Map(rows.map(r => [r.id, crypto.randomUUID()]));
const ids = {
  subjects: idMap(src.subjects),
  students: idMap(src.students),
  grading_periods: idMap(src.grading_periods),
  assessments: idMap(src.assessments),
  assessment_columns: idMap(src.assessment_columns),
  scores: idMap(src.scores),
  attendance_config: idMap(src.attendance_config),
  student_groups: idMap(src.student_groups),
  group_students: idMap(src.group_students),
};

const insert = {
  subjects: sqlite.prepare(`INSERT INTO subjects (id, name, section, school_year, semester, prelim_weight, midterm_weight, final_weight, owner_device_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  students: sqlite.prepare(`INSERT INTO students (id, subject_id, last_name, first_name, middle_name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`),
  grading_periods: sqlite.prepare(`INSERT INTO grading_periods (id, subject_id, type, created_at, updated_at) VALUES (?,?,?,?,?)`),
  assessments: sqlite.prepare(`INSERT INTO assessments (id, period_id, name, is_exam, sort_order, weight_percent, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`),
  assessment_columns: sqlite.prepare(`INSERT INTO assessment_columns (id, assessment_id, date, max_score, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`),
  scores: sqlite.prepare(`INSERT INTO scores (id, column_id, student_id, value, created_at, updated_at) VALUES (?,?,?,?,?,?)`),
  attendance_config: sqlite.prepare(`INSERT INTO attendance_config (id, period_id, present_score, late_score, absent_score, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`),
  student_groups: sqlite.prepare(`INSERT INTO student_groups (id, name, description, owner_device_id, created_at, updated_at) VALUES (?,?,?,?,?,?)`),
  group_students: sqlite.prepare(`INSERT INTO group_students (id, group_id, last_name, first_name, middle_name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`),
};

const migrate = sqlite.transaction(() => {
  for (const r of src.subjects) {
    insert.subjects.run(ids.subjects.get(r.id), r.name, r.section, r.school_year, r.semester,
      Number(r.prelim_weight), Number(r.midterm_weight), Number(r.final_weight),
      device.device_id, toISO(r.created_at), now);
  }
  for (const r of src.grading_periods) {
    insert.grading_periods.run(ids.grading_periods.get(r.id), ids.subjects.get(r.subject_id), r.type, now, now);
  }
  for (const r of src.students) {
    insert.students.run(ids.students.get(r.id), ids.subjects.get(r.subject_id),
      r.last_name, r.first_name, r.middle_name || '', r.sort_order ?? 0, now, now);
  }
  for (const r of src.assessments) {
    insert.assessments.run(ids.assessments.get(r.id), ids.grading_periods.get(r.period_id),
      r.name, r.is_exam ? 1 : 0, r.sort_order ?? 0, Number(r.weight_percent) || 0, now, now);
  }
  for (const r of src.assessment_columns) {
    insert.assessment_columns.run(ids.assessment_columns.get(r.id), ids.assessments.get(r.assessment_id),
      r.date ? String(r.date).slice(0, 10) : null, Number(r.max_score) || 0, r.sort_order ?? 0, now, now);
  }
  for (const r of src.scores) {
    insert.scores.run(ids.scores.get(r.id), ids.assessment_columns.get(r.column_id),
      ids.students.get(r.student_id), r.value === null ? null : Number(r.value), now, now);
  }
  for (const r of src.attendance_config) {
    insert.attendance_config.run(ids.attendance_config.get(r.id), ids.grading_periods.get(r.period_id),
      Number(r.present_score), Number(r.late_score), Number(r.absent_score), now, now);
  }
  for (const r of src.student_groups) {
    insert.student_groups.run(ids.student_groups.get(r.id), r.name, r.description || '',
      device.device_id, toISO(r.created_at), now);
  }
  for (const r of src.group_students) {
    insert.group_students.run(ids.group_students.get(r.id), ids.student_groups.get(r.group_id),
      r.last_name, r.first_name, r.middle_name || '', r.sort_order ?? 0, now, now);
  }
});
migrate();

console.log('Migration complete →', path.join(dataDir, 'gradebook.sqlite'));
for (const [table, rows] of Object.entries(src)) {
  console.log(`  ${table.padEnd(20)} ${rows.length} rows`);
}
sqlite.close();
