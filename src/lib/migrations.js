/**
 * Versioned schema migrations — how app updates keep existing data safe.
 *
 * - schema.mjs always describes the CURRENT schema, written entirely with
 *   CREATE ... IF NOT EXISTS. On a fresh install it creates everything at
 *   the newest shape; on an existing database it is a no-op for tables that
 *   already exist (their old shape is preserved for the migrations below).
 * - Every database carries its schema version in PRAGMA user_version. When
 *   an updated app opens an older database, the numbered steps below run in
 *   order — each inside a transaction — upgrading it IN PLACE. Grades are
 *   never dropped, exported, or recreated.
 *
 * Adding a migration (whenever a future feature changes the schema):
 *   1. Update schema.mjs to the new shape (covers fresh installs).
 *   2. Bump SCHEMA_VERSION.
 *   3. Register MIGRATIONS[<new version>] with the in-place upgrade for
 *      databases created before this version.
 *
 * Rules for migration steps:
 *   - Additive only: ALTER TABLE ... ADD COLUMN, CREATE TABLE/INDEX.
 *     Never DROP tables or columns that hold user data.
 *   - schema.mjs runs BEFORE migrations, so guard anything it also creates
 *     (new tables/indexes) with IF NOT EXISTS inside the step too.
 *   - New columns must be NULLable or carry a DEFAULT — existing rows must
 *     stay valid without a rewrite.
 */

export const SCHEMA_VERSION = 4;

export const MIGRATIONS = {
  // v2 — sync conflict audit log (local-only, never synced): every time a
  // merge overwrites a row that THIS laptop changed since the last common
  // state with that peer, the discarded version is recorded here. Nothing
  // is ever lost silently.
  2: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        row_id TEXT,
        peer_device_id TEXT,
        winner TEXT NOT NULL,
        winner_row TEXT NOT NULL,
        loser_row TEXT NOT NULL,
        winner_updated_at TEXT,
        loser_updated_at TEXT,
        resolved_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolved ON sync_conflicts(resolved_at);
    `);
  },

  // v3 — recycle bin support on the two top-level deletable things:
  //   purged_at             "permanently deleted": still a synced tombstone
  //                         (hard-deleting rows would break snapshot sync),
  //                         but hidden from the recycle bin forever.
  //   deleted_by_device_id  which laptop performed the deletion (display).
  // Both columns are synced (see engine.mjs SYNCED_TABLES + snapshot
  // schema_version bump), NULLable, and additive.
  3: (db) => {
    for (const table of ['subjects', 'student_groups']) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes('purged_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN purged_at TEXT`);
      if (!cols.includes('deleted_by_device_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_by_device_id TEXT`);
    }
  },

  // v4 — name suffix (Jr., Sr., II, III …) on students and group members.
  // A dedicated column: displayed after the name, never part of sorting.
  4: (db) => {
    for (const table of ['students', 'group_students']) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes('suffix')) db.exec(`ALTER TABLE ${table} ADD COLUMN suffix TEXT NOT NULL DEFAULT ''`);
    }
  },
};

/**
 * Bring `db` up to `targetVersion`. Returns { from, to, applied }.
 * The options parameter exists so tests can drive the exact same code path
 * with a scratch version/migration set; production callers pass nothing.
 */
export function runMigrations(
  db,
  { targetVersion = SCHEMA_VERSION, migrations = MIGRATIONS, log = console } = {}
) {
  const from = db.pragma('user_version', { simple: true });

  if (from === 0) {
    // Brand-new database: the schema (already executed by the caller) just
    // created the current shape directly — stamp it and done.
    db.pragma(`user_version = ${targetVersion}`);
    return { from: 0, to: targetVersion, applied: [] };
  }

  if (from > targetVersion) {
    // Database written by a NEWER app version (this copy was rolled back or
    // not yet updated). Extra tables/columns are harmless to SQLite reads
    // and writes, so keep working — but say so.
    log.warn(
      `[db] database schema is v${from} but this app knows v${targetVersion} — ` +
      'it will keep working, but update the app when you can.'
    );
    return { from, to: from, applied: [] };
  }

  const applied = [];
  let version = from;
  while (version < targetVersion) {
    const next = version + 1;
    const step = migrations[next];
    if (typeof step !== 'function') {
      throw new Error(
        `[db] no migration registered for schema v${next} — refusing to touch the database.`
      );
    }
    // Transactional: a failing step rolls back completely, leaving the
    // database at its previous version (and the launch backup untouched).
    db.transaction(() => {
      step(db);
      db.pragma(`user_version = ${next}`);
    })();
    version = next;
    applied.push(next);
    log.info?.(`[db] migrated database schema v${next - 1} → v${next}`);
  }
  return { from, to: version, applied };
}
