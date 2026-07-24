/**
 * The database schema — single source of truth, statically imported.
 *
 * WHY A JS MODULE (not a .sql file read at runtime): a runtime file read
 * with a dynamic path made Next.js output tracing glob the ENTIRE project
 * root into the standalone bundle (src/, scripts/, dist/, ... — gigabytes,
 * including previous builds recursively). A static import is bundled by the
 * compiler like any other code: nothing to locate, copy, or trace.
 *
 * Editing: this is plain SQL inside a template literal. Keep it free of
 * backticks and dollar-brace sequences. Existing databases are upgraded via
 * src/lib/migrations.js — see the rules there before changing tables.
 */

export const SCHEMA_SQL = `
-- Gradebook schema (SQLite).
--
-- Sync-ready design decisions:
--  * TEXT UUID primary keys everywhere (two devices can create rows offline
--    without id collisions).
--  * created_at / updated_at ISO-8601 UTC strings on every table; updated_at
--    is the last-write-wins ordering key for sync merges.
--  * deleted_at tombstones: rows are soft-deleted (with cascade in the query
--    layer) so deletions propagate through sync instead of resurrecting.
--  * owner_device_id records which installation created a subject / group —
--    an advisory label, not a permission system.
--
-- Dates (assessment_columns.date) are plain 'YYYY-MM-DD' strings end-to-end.

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject_code TEXT NOT NULL DEFAULT '',   -- e.g. IT101 (optional, display-first)
  section TEXT NOT NULL,
  school_year TEXT NOT NULL,
  semester TEXT NOT NULL,
  prelim_weight REAL NOT NULL DEFAULT 30,
  midterm_weight REAL NOT NULL DEFAULT 30,
  final_weight REAL NOT NULL DEFAULT 40,
  owner_device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  purged_at TEXT,              -- "permanently deleted": hidden from the recycle bin (still synced as a tombstone)
  deleted_by_device_id TEXT    -- which laptop deleted it (recycle-bin display)
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',      -- Jr., Sr., II, III … display-only, never sorted
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_students_subject ON students(subject_id);

CREATE TABLE IF NOT EXISTS grading_periods (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PRELIM','MIDTERM','FINAL')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (subject_id, type)
);
CREATE INDEX IF NOT EXISTS idx_periods_subject ON grading_periods(subject_id);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES grading_periods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_exam INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  weight_percent REAL NOT NULL DEFAULT 0,
  behavior TEXT NOT NULL DEFAULT 'columns',  -- 'columns' (classic) | 'workspace' (one computed column, details in a workspace) (schema v9)
  span TEXT NOT NULL DEFAULT 'period',       -- 'period' | 'term' (term-span projects into every period band)
  agg_method TEXT NOT NULL DEFAULT 'sum',    -- how detail columns aggregate: 'sum' | 'sum_capped' | 'average'
  agg_max REAL,                              -- configured target total (never derived from student performance)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_assessments_period ON assessments(period_id);

CREATE TABLE IF NOT EXISTS assessment_columns (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  date TEXT,
  max_score REAL NOT NULL DEFAULT 100,
  attendance_source INTEGER NOT NULL DEFAULT 0,  -- scoring this date auto-marks Present in Attendance
  sort_order INTEGER NOT NULL DEFAULT 0,
  period_type TEXT,                     -- term-span workspace details: which grading period this column belongs to (schema v9)
  label TEXT NOT NULL DEFAULT '',       -- session title / manual short-code override ('' = automatic code) (schema v9)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_columns_assessment ON assessment_columns(assessment_id);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES assessment_columns(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  value REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (column_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_student ON scores(student_id);

CREATE TABLE IF NOT EXISTS attendance_config (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES grading_periods(id) ON DELETE CASCADE,
  present_score REAL NOT NULL DEFAULT 10,
  late_score REAL NOT NULL DEFAULT 8,
  absent_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (period_id)
);

-- Student Groups: reusable rosters independent from any subject.
-- Importing a group into a subject COPIES the students, so gradebooks stay
-- independent even if the group changes later.
CREATE TABLE IF NOT EXISTS student_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  purged_at TEXT,              -- "permanently deleted": hidden from the recycle bin (still synced as a tombstone)
  deleted_by_device_id TEXT    -- which laptop deleted it (recycle-bin display)
);

CREATE TABLE IF NOT EXISTS group_students (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',      -- Jr., Sr., II, III … display-only, never sorted
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_group_students_group ON group_students(group_id);

-- Free-form notes (schema v8) — the margin scribbles of a paper record.
-- ONE table for every annotation level, present and future:
--   entity_type 'column'  entity_id = assessment_columns.id   (a date's note)
--   entity_type 'cell'    entity_id = column_id || ':' || student_id
--   entity_type 'student' entity_id = students.id             (future UI)
--   entity_type 'subject' entity_id = subjects.id             (future UI)
-- Notes are INDEPENDENT data: a score can be blank while its note remains;
-- only deleting the note removes it. subject_id is denormalized so one
-- indexed query loads a gradebook's notes (and future "Search Notes" is a
-- WHERE body LIKE over this single table). Synced like everything else:
-- UUID id, natural key (entity_type, entity_id), updated_at LWW, tombstones.
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('subject','student','column','cell')),
  entity_id TEXT NOT NULL,
  subject_id TEXT,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_notes_subject ON notes(subject_id);

-- Sync conflict audit log (LOCAL-ONLY — never exported in snapshots).
-- One row per merge decision that overwrote a value THIS laptop changed
-- since the last common state with that peer (schema v2).
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_id TEXT,
  peer_device_id TEXT,
  winner TEXT NOT NULL,        -- 'peer' or 'local': whose version was kept
  winner_row TEXT NOT NULL,    -- JSON of the row that was kept
  loser_row TEXT NOT NULL,     -- JSON of the row that was discarded
  winner_updated_at TEXT,
  loser_updated_at TEXT,
  resolved_at TEXT NOT NULL,
  reviewed_at TEXT             -- set when the user reviews/restores (schema v7)
);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolved ON sync_conflicts(resolved_at);
`;
