CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  section VARCHAR(100) NOT NULL,
  school_year VARCHAR(20) NOT NULL,
  semester VARCHAR(50) NOT NULL,
  prelim_weight DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  midterm_weight DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  final_weight DECIMAL(5,2) NOT NULL DEFAULT 40.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS grading_periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  type ENUM('PRELIM','MIDTERM','FINAL') NOT NULL,
  UNIQUE KEY uq_subject_period (subject_id, type),
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  is_exam TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  weight_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  FOREIGN KEY (period_id) REFERENCES grading_periods(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  date DATE DEFAULT NULL,
  max_score DECIMAL(8,2) NOT NULL DEFAULT 100.00,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  column_id INT NOT NULL,
  student_id INT NOT NULL,
  value DECIMAL(8,2) DEFAULT NULL,
  UNIQUE KEY uq_col_student (column_id, student_id),
  FOREIGN KEY (column_id) REFERENCES assessment_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_id INT NOT NULL,
  present_score DECIMAL(8,2) NOT NULL DEFAULT 10.00,
  late_score DECIMAL(8,2) NOT NULL DEFAULT 8.00,
  absent_score DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  UNIQUE KEY uq_period (period_id),
  FOREIGN KEY (period_id) REFERENCES grading_periods(id) ON DELETE CASCADE
);

-- Student Groups: reusable rosters independent from any subject.
-- Importing a group into a subject COPIES the students, so gradebooks stay
-- independent even if the group changes later.
CREATE TABLE IF NOT EXISTS student_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (group_id) REFERENCES student_groups(id) ON DELETE CASCADE
);
