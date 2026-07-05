import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3307', 10),
  database: process.env.DB_NAME || 'gradebook',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
});

async function migrate() {
  try {
    const migrationPath = path.join(process.cwd(), 'src/lib/migrations/add_title_column.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    
    const statements = migration.split(';').filter(s => s.trim());
    
    for (const stmt of statements) {
      if (stmt.trim()) {
        console.log('Executing:', stmt.trim().substring(0, 50) + '...');
        await pool.query(stmt.trim());
      }
    }
    
    console.log('Migration completed successfully!');
    await pool.end();
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
