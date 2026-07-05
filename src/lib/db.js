import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3307', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
});

let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  try {
    // Connect without database first to ensure the database exists
    const tempConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3307', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'gradebook'}\``);
    await tempConn.end();

    const schemaPath = path.join(process.cwd(), 'src/lib/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    initialized = true;
  } catch (err) {
    console.error('Failed to initialize database:', err);
    throw err;
  }
}

const db = {
  async query(sql, params) {
    await ensureInitialized();
    return pool.query(sql, params);
  },
  async getConnection() {
    await ensureInitialized();
    return pool.getConnection();
  },
};

export default db;
