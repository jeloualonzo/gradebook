import fs from 'fs';
import path from 'path';
import db from '@/lib/db';

const BACKUPS_KEPT = 14; // must match electron/main.js BACKUPS_TO_KEEP

// Automatic launch backups live NEXT TO the data folder (../backups) — the
// desktop shell writes them before the server opens the database.
export async function GET() {
  try {
    const dir = path.join(db.paths.dataDir, '..', 'backups');
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();
    } catch {
      /* no backups yet (or plain web mode) */
    }
    // Folder names are filesystem-safe ISO stamps: restore the punctuation.
    const latest = names[0] || null;
    const latestAt = latest
      ? latest.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
      : null;
    return Response.json({
      backups_dir: dir,
      count: names.length,
      latest_at: latestAt,
      keep: BACKUPS_KEPT,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
