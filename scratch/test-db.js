const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length === 2) {
    env[parts[0].trim()] = parts[1].trim();
  }
});

async function run() {
  try {
    const conn = await mysql.createConnection({
      host: env.DB_HOST || 'localhost',
      port: parseInt(env.DB_PORT || '3307', 10),
      database: env.DB_NAME || 'gradebook',
      user: env.DB_USER || 'root',
      password: env.DB_PASSWORD || '',
    });

    console.log('Initializing periods and assessments for subject 1...');

    // 1. Prelim
    const [pRes] = await conn.query("INSERT INTO grading_periods (subject_id, type) VALUES (1, 'PRELIM')");
    const prelimId = pRes.insertId;
    await conn.query("INSERT INTO attendance_config (period_id, present_score, late_score, absent_score) VALUES (?, 10, 8, 0)", [prelimId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Attendance', 0, 0, 10)", [prelimId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Quiz', 0, 1, 30)", [prelimId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Prelim Exam', 1, 2, 60)", [prelimId]);

    // 2. Midterm
    const [mRes] = await conn.query("INSERT INTO grading_periods (subject_id, type) VALUES (1, 'MIDTERM')");
    const midtermId = mRes.insertId;
    await conn.query("INSERT INTO attendance_config (period_id, present_score, late_score, absent_score) VALUES (?, 10, 8, 0)", [midtermId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Attendance', 0, 0, 10)", [midtermId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Quiz', 0, 1, 30)", [midtermId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Midterm Exam', 1, 2, 60)", [midtermId]);

    // 3. Final
    const [fRes] = await conn.query("INSERT INTO grading_periods (subject_id, type) VALUES (1, 'FINAL')");
    const finalId = fRes.insertId;
    await conn.query("INSERT INTO attendance_config (period_id, present_score, late_score, absent_score) VALUES (?, 10, 8, 0)", [finalId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Attendance', 0, 0, 10)", [finalId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Quiz', 0, 1, 30)", [finalId]);
    await conn.query("INSERT INTO assessments (period_id, name, is_exam, sort_order, weight_percent) VALUES (?, 'Final Exam', 1, 2, 60)", [finalId]);

    console.log('Subject 1 successfully initialized!');
    await conn.end();
  } catch (err) {
    console.error('Initialization error:', err);
  }
}

run();
