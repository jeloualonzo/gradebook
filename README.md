# Faculty Gradebook

A spreadsheet-style gradebook for instructors: subjects with PRELIM / MIDTERM / FINAL
grading periods, weighted assessments, quick attendance, reusable student groups with
Excel import, undo/redo, and keyboard-first score encoding.

Built with [Next.js](https://nextjs.org) + React. **Storage is a zero-configuration
SQLite database** — no database server, no ports, no environment variables.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). That's it — on first run the app
creates its database automatically.

## Where your data lives

Everything is stored in the `data/` folder (created automatically, ignored by git):

| File | Purpose |
|---|---|
| `data/gradebook.sqlite` | The entire database — one file. **Backup = copy this file.** |
| `data/device.json` | This installation's identity (a generated device id + label). Used to tag which laptop created each subject/group — not an account, nothing to log into. |

Set `GRADEBOOK_DATA_DIR` to relocate the folder (the desktop build will point this at
the OS app-data directory).

> ⚠️ Don't place `data/` inside a cloud-synced folder (Dropbox/Drive/OneDrive) —
> cloud clients can corrupt a live SQLite database. Future sync exchanges exported
> snapshots instead.

## Migrating from the old MySQL setup

If you previously ran this app against MySQL, a one-time converter carries everything
over (mapping ids to UUIDs, preserving all relationships):

```bash
DB_HOST=localhost DB_PORT=3307 DB_NAME=gradebook DB_USER=root DB_PASSWORD=... \
  npm run migrate:from-mysql
```

It refuses to overwrite an SQLite database that already has data (`--force` to merge).
After migrating, MySQL can be uninstalled — the app never touches it again.

## Importing students from Excel

Student Groups accept `.xlsx` / `.xls` rosters with exactly three columns —
**First Name, Middle Name, Last Name** (case-insensitive headers). Blank rows are
ignored, values are trimmed, and duplicates (same full name) are skipped automatically.

## Roadmap

- **Phase 2** — Desktop app (Electron): double-click install, no Node required.
- **Phase 3** — Optional two-laptop sync via a shared folder (offline-first, no accounts).
