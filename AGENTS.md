# AGENTS.md — Developer Handbook

**Audience:** AI agents and engineers continuing development of this project.
This is the technical handbook: how the system works, how to change it safely, and
what must never be broken. For project philosophy and user preferences read
`CLAUDE.md`; for a narrative orientation read `PROJECT_HANDOVER.md`; for the
product vision and phase plan read `ROADMAP.md` — **consult it before proposing
or implementing any improvement.**

**The product:** Faculty Gradebook — an offline-first Windows desktop app for two
instructors who share subjects and grade on two laptops, synchronized through a
shared folder (Google Drive / OneDrive / USB). No accounts, no server, no cloud
backend. Philippine academic structure: subjects → PRELIM / MIDTERM / FINAL
grading periods → assessments (Attendance, Quiz, …, Exam) → dated columns →
scores; period grades and a weighted final grade are computed live.

---

## 1. Architecture overview

Three layers, deliberately decoupled:

```
Electron shell (electron/)          — window, lifecycle, updates, sync timing
  └─ boots →  Next.js standalone server (localhost, free port)
                └─ owns →  SQLite database (better-sqlite3, WAL)
Browser UI (src/app, src/components) — talks ONLY to the localhost HTTP API
```

- The web app is complete without Electron: `npm run dev` gives the identical
  product in a browser. Electron adds packaging, window management, background
  sync scheduling, and auto-updates — it never reaches into the database.
- All state mutations go through Next API routes (`src/app/api/**`), which call
  query modules (`src/lib/queries/*`). UI components never touch SQL.
- The sync engine is a **pure module** (`src/lib/sync/engine.mjs`) with zero I/O;
  all file/DB plumbing lives in `src/lib/sync/index.js`.

## 2. Folder structure

```
electron/            Main process: main.js (boot/lifecycle), preload.js (IPC
                     surface: gradebookDesktop.*), window-state.js, lib.js
src/app/             Next App Router pages + API routes
  api/**             ALL data access goes through these routes
  subjects/[id]/     The gradebook (primary workspace) + attendance page
  groups/, settings/, subjects/new/
src/components/      React components (GradebookTable is the heart)
src/lib/
  db.js              SQLite handle, WAL, migrations bootstrap, device identity
  schema.mjs         CURRENT schema as ONE static SQL template literal
  migrations.js      PRAGMA user_version steps (see §6)
  sync/engine.mjs    Pure merge engine + SYNCED_TABLES registry
  sync/review.mjs    Pure review semantics — what deserves a conflict entry
  sync/index.js      Snapshot I/O, conflict log, review/restore
  queries/*.js       SQL per domain (subjects, students, scores, groups, …)
  gradeCalculator.js Integer-cents math (toCents/centsToNumber/formatNumber)
  names.js           displayName/searchText — THE name format, used everywhere
  uiConfig.js        Every UI width/size constant
  hooks/             useGradebook, useHistory, useAutosave, useHotkey, usePageTitle
scripts/
  build-desktop.mjs  The whole build + release pipeline (§8–9)
  test-*.mjs         Permanent test suites (§10)
data/, backups/      Local dev database — NEVER shipped, NEVER synced
```

## 3. How Electron starts the Next server (`electron/main.js`)

1. Splash window appears instantly (data-URL HTML).
2. Per-launch backup of the SQLite file into `<userData>/backups/` (keep 14).
3. Locates the server: packaged → `resources/server/server.js`; dev →
   `.next/standalone/server.js`.
4. `utilityProcess.fork(server.js)` with env: `PORT` (free port found at
   runtime), `HOSTNAME=127.0.0.1`, `GRADEBOOK_DATA_DIR=<userData>/data`.
5. Polls the port (90s timeout — cold starts on Windows can be slow while the
   antivirus rescans thousands of server files), then opens the main window.
6. Window state (size/position/maximized/zoom) restores via
   `electron/window-state.js`; a dynamic port means Chromium's own per-origin
   zoom memory never applies, so zoom is managed and persisted explicitly.
7. Sync lifecycle: one run at launch, every 5 minutes, and a bounded (~6s) run
   at quit (`before-quit` intercepts, syncs, then re-quits). All sync runs are
   HTTP POSTs to `/api/sync/run` — Electron never syncs directly.
8. Single-instance lock; second launch focuses the existing window.

Storage layout under `%APPDATA%/Gradebook/`:
`data/gradebook.sqlite`, `data/device.json` (device id/label/peers/sync folder),
`data/own-exports/` (basis ring), `backups/<timestamp>/`, `logs/server.log`,
`window-state.json`.

## 4. SQLite architecture

- `better-sqlite3` (synchronous), `journal_mode = WAL`, `foreign_keys = ON`,
  `busy_timeout = 5000`.
- UUID string primary keys everywhere (`crypto.randomUUID()`), ISO-8601 UTC
  `updated_at` stamped by `db.now()` on every write — this string is the
  **LWW ordering key** for sync; treat it as sacred (§13).
- Soft deletes: synced rows are never hard-deleted. `deleted_at` = tombstone
  (recycle bin), `purged_at` = "permanently deleted" (still a synced tombstone,
  hidden from the bin forever). Hard-deleting a synced row breaks snapshot
  merge — don't.
- Money-grade math: scores/weights compare and normalize through integer cents
  (`toCents`) — never raw float comparison.
- The database was migrated FROM MySQL early in the project
  (`scripts/migrate-mysql-to-sqlite.mjs` remains for reference). SQLite won
  because: no server process, zero configuration, single-file backup/restore,
  perfect for offline-first desktop.

## 5. Schema philosophy (`src/lib/schema.mjs`)

- ONE static template literal with `CREATE ... IF NOT EXISTS` describing the
  CURRENT shape. Fresh installs execute it and get stamped at the newest
  version; existing databases no-op here and upgrade via migrations.
- **It must remain a static import.** A dynamic `fs.readFile` of a schema file
  once made Next's file tracer glob the entire project root (recursively —
  including `dist/`) into the desktop bundle: a 1.5 GB installer. The only
  sanctioned dynamic reads in server code are `device.json` and the backups
  listing (excluded via `outputFileTracingExcludes` in `next.config.mjs`), and
  `scripts/build-desktop.mjs` has a tracer-regression guard that fails the
  build if junk paths reappear in the bundle.

## 6. Migration philosophy (`src/lib/migrations.js`) — TWO version numbers

**Never confuse these:**

1. **Database version** — `PRAGMA user_version`, `SCHEMA_VERSION` in
   `migrations.js` (currently **7**). Bumps whenever any table changes,
   including local-only tables.
2. **Snapshot compatibility version** — `SCHEMA_VERSION` in
   `sync/engine.mjs` (currently **5**). Bumps ONLY when the shape of
   `SYNCED_TABLES` changes. Local-only tables (e.g. `sync_conflicts`) never
   touch it. A device refuses snapshots from a NEWER snapshot version and asks
   to be updated; older snapshots import fine via per-column `defaults`.

Migration rules (enforced by convention, all steps 2→7 follow them):
- Additive only: `ALTER TABLE … ADD COLUMN`, `CREATE TABLE/INDEX IF NOT EXISTS`.
  Never drop user data.
- New columns NULLable or with DEFAULT; guard with `PRAGMA table_info` checks
  (SQLite has no `ADD COLUMN IF NOT EXISTS`).
- `runMigrations` wraps the whole chain in ONE `IMMEDIATE` transaction and
  re-reads the version under the write lock — `next build` runs several worker
  processes that all open the DB simultaneously; this is why it doesn't die
  with `SQLITE_BUSY_SNAPSHOT`. Keep it that way.
- Adding a synced column additionally requires: `SYNCED_TABLES` columns +
  `defaults` entry (so OLDER snapshots import with a sane value, not NULL into
  NOT NULL), snapshot `SCHEMA_VERSION` bump, and fixture updates in
  `scripts/test-sync-engine.mjs`.

## 7. Sync architecture

**Transport:** each device writes ONE gzip JSON file into the shared folder —
`gradebook-<device_id>.json.gz` — containing its **full state** (every row of
every synced table, tombstones included) plus a `basis` declaration. Writes are
atomic (temp file + rename). `runSync` = import all peer files, then export
(so the export already reflects the merge).

**Merge (pure, `engine.mjs`):** row-by-row, matched by identity key — the UUID,
or a **natural key** for tables where two devices can legitimately create "the
same" row independently (`scores` = column+student, `grading_periods` =
subject+type, `attendance_config` = period). Decision: newer `updated_at` wins
whole-row (string compare of ISO UTC); exact ties break by higher device id.
Natural-key winners are adopted **id included**, so independently created twins
converge to one row instead of crashing on UNIQUE. The merge is deterministic,
commutative, and idempotent — convergence is guaranteed regardless of sync
order (per-key max under a total order).

**Applying:** parents before children in `SYNCED_TABLES` order, one
transaction, **upserts only** — never `INSERT OR REPLACE` (REPLACE deletes
first and would fire `ON DELETE CASCADE`, wiping children). The chained
`ON CONFLICT(naturalKey) … ON CONFLICT(id)` statement handles twin adoption.
Rows are written exactly as the snapshot has them: `updated_at` belongs to the
original edit, never to the merge.

**Safety rails:** content-hash up-to-date gate per peer file (clock-agnostic);
per-file try/catch (one bad snapshot never blocks the run; the gate doesn't
advance so it retries); corrupt files skipped; clock-skew detection (>5 min
ahead → warning surfaced in UI); sync folder must never be/contain the data
dir (`validateSyncFolder` — the SQLite-in-Dropbox corruption trap).

**Conflict detection (the `basis` mechanism):** each export declares which of
each peer's files it had absorbed. The importer loads its own archived copy of
that export (`data/own-exports/`, ring of 8) as the *exact common ancestor*.
A conflict is logged only when BOTH sides changed a row since that common
state — everything else is ordinary propagation and stays silent. Entries in
`sync_conflicts` (LOCAL-only, capped 500) store the FULL winner and loser rows
as JSON, so nothing is ever silently lost. No basis (first contact / pruned
ring) → merge normally, log nothing.

**Semantic conflicts only (v1.0.9, `sync/review.mjs`):** an entry is logged
only when winner and loser differ in USER-VISIBLE data — the review page
answers one question: "did the two laptops produce different gradebook
data?" Bookkeeping never qualifies: `id`/`created_at`/`updated_at`, device
attribution (`owner_device_id`, `deleted_by_device_id`), the exact
`deleted_at`/`purged_at` timestamps (their PRESENCE — deleted vs active — is
data and always logs), and `students.sort_order` (rosters render
alphabetically everywhere, so the value is invisible; group members,
assessments, and date columns keep sort_order semantic and the details view
shows it as "Position"). Identical no-op re-saves and identical
independently-created twins converge silently. The merge itself is
untouched — rows still propagate on any difference, updated_at included, so
convergence is unaffected; review.mjs is consulted by the LOGGER only.

**Review & restore (v1.0.7–1.0.8):** `reviewed_at` tracks review state;
surfaces = toast after any sync that resolved conflicts (ConflictWatcher polls
`/api/sync` — works for startup/periodic/shutdown syncs), amber count badge on
the Settings gear, Settings → Sync Conflicts tab, and a banner inside affected
subjects. `conflictDetails()` builds a gradebook-language payload (subject /
period / assessment / date / student context + a miniature-gradebook or
field-by-field comparison, LIVE current values, `superseded` flag). **Restore
is an ordinary new edit**: the discarded values are written onto the current
row with a fresh `updated_at`, so it propagates through normal sync, wins
everywhere, and provably logs no new conflicts. The merge engine knows nothing
about review — keep it that way.

## 8. Build pipeline (`scripts/build-desktop.mjs`)

The whole pipeline is script-owned and idempotent. Key stages:

1. `ensureRootNodeAbi` — the root `node_modules/better-sqlite3` must match the
   **Node** ABI for `next build` to run. The probe must **construct** a
   `Database` (a bare `require` passes on the wrong ABI). Self-heals via
   `prebuild-install`.
2. `BUILD_STANDALONE=1 next build` → `.next/standalone`.
3. Tracer-regression guard: fails if junk (`data`, `backups`, `src`, `scripts`,
   `dist`, `electron`, `build`, `README.md`) appears in the bundle.
4. `materializeDir` — on Windows the standalone output contains
   **hardlinks/symlinks back into the real `node_modules`**. Writing through
   them corrupts the source files (this really happened). Links are
   materialized into real copies before anything is overwritten, and target
   dirs are removed before writes.
5. Swap the standalone copies of better-sqlite3 to the **Electron** ABI
   (`prebuild-install --runtime=electron`), including Next's hashed copies.
6. Icon (base64 → `build/icon.ico`), electron-builder with **`--publish
   never`** — ALWAYS. electron-builder's own publisher runs two parallel
   publish tasks that race creating the GitHub release (we shipped a
   half-uploaded release once). Publishing is done by our script instead.

ABI cheat-sheet: root node_modules = Node ABI (build-time); packaged
standalone = Electron ABI (runtime). To run the standalone server under plain
`node` (the test lab), rebuild with `BUILD_STANDALONE=1 npx next build` first —
after a desktop build it contains Electron-ABI binaries and will not load.

## 9. Release pipeline & auto-update

**Commands** (`package.json`): `desktop:bundle` (server only), `desktop:pack`
(unpacked dir), `desktop:build` (installer), `desktop:release` (installer +
publish to GitHub Releases).

**Publish flow (script-owned, idempotent):** requires `GH_TOKEN` env (classic
PAT with `repo` scope; `setx` only affects NEW terminals — fully restart the
terminal/VS Code). Preflight at script top. Steps: create+push git tag
`v<version>` (published releases REQUIRE an existing tag), GET release by tag →
reuse or create, synthesize `latest.yml` if missing (sha512 base64 + size),
DELETE leftover partial assets by id, upload `…Setup.exe`, `.blockmap`,
`latest.yml`. Token is scrubbed from all output. Re-running repairs a partial
release. Asset uploads stream over `node:https`, deliberately NOT `fetch` —
undici's fixed 300s response-headers deadline killed the v1.0.8 publish AFTER
the 113 MB installer had fully uploaded (an upload's response only arrives
once the whole body is received, and Node exposes no knob for that deadline
short of adding undici as a dependency). The uploader uses an inactivity
timeout while streaming, a wide post-body response window, adopts the asset
if it landed complete despite a lost response (same run = same bytes, so
`latest.yml`'s sha512 stays valid), then deletes partials and retries once.

**Auto-update:** `electron-updater` against the public GitHub repo. Critical
packaging detail: root `package.json` `dependencies` contains **ONLY**
`electron-updater` — all web deps live in `devDependencies`, so
electron-builder packs just the updater subtree into the asar. Checks 15s after
boot + every 4h; downloads in background; installs on "Restart and Update" (a
pre-update sync runs first) or on normal quit. Status shown in the status-bar
pill and Settings → General. Dev runs (`!app.isPackaged`) never self-update.

**Standard release routine:** bump `version` in package.json → commit/push →
on the Windows machine: `git pull`, `npm run desktop:release`. Both laptops
auto-update. The repo tracks `package-lock.json` — keep it in sync with any
dependency change (a stale committed lock caused a pull conflict once).

## 10. Testing philosophy

Tests are **permanent scripts, not a framework** — plain Node, explicit
assertions, readable PASS/FAIL output. Anything that guards data integrity has
a test; UI polish is verified by lint + build + targeted SSR render harnesses.

| Suite | What it proves | How |
|---|---|---|
| `test-sync-engine.mjs` (50) | Pure merge semantics: LWW, ties, tombstones, natural-key twins, defaults for old snapshots, idempotence — plus review semantics (what is/isn't a reviewable conflict) | Fixtures, no I/O |
| `test-grid-selection.mjs` (42) | Pure selection model (anchors/extends/clamps, row/column/all, geometry-change collapse, stats math) + TSV clipboard (round-trips, Excel quirks, tile/block/clip shapes, token rules) + fill plans (Ctrl+D top-row-repeats, single-cell copy-above, drag-fill tiling) | Fixtures, no I/O |
| `test-sync-scenarios.mjs` (60) | Real two-laptop life: disjoint merges, same-cell conflict, late syncer, alternation convergence (byte-identical dumps), conflict log precision, recycle bin propagation, review/restore/details, semantic-only logging + no-op write guards (S12) | TWO live app instances (ports 3131/3132) + real shared folder `/tmp/sync-lab/share` |
| `test-class-stats.mjs` (25) | Period-closing semantics (active-column rule, fill-blanks scopes, footer math, thresholds, ranking) + term sequencing (rollover defaults) + the student-focus model (P/L/A letters via config, missing list, grade agreement with the calculator) | Fixtures, no I/O |
| `test-recycle-bin.mjs` (14) | Restore/purge correctness | Live instance (3146) |
| `test-workflows.mjs` (38) | Group-from-subject, move-column, counts-as-attendance, bulk attendance parity, semester rollover, remove-imported-group (name-identity matching, dry-run preview, scores travel with their students, groups untouched) | Live instance (3171) |
| `test-window-state.mjs` (30) | Bounds sanitizing, zoom clamp/persist, full manage() lifecycle | Stub Electron window |

Run the lab: build plain standalone, `mkdir -p /tmp/sync-lab/{a,b,share}`,
start two servers with `GRADEBOOK_DATA_DIR` + `PORT`, run the script, kill by
saved PIDs (the Next process renames itself — don't pkill by name).

**Verification discipline before every push:** `npx eslint src/ scripts/
--quiet` (includes `no-undef` — it caught a real shipped crash), relevant test
suites, `node scripts/build-desktop.mjs --no-pack`, and after pushing compare
the remote blob SHA against local `git hash-object`.

## 11. Coding conventions

- **React 19 + react-hooks v6 lint is strict.** No synchronous `setState`
  inside effects — use the documented render-time adjustment pattern
  (`const [prev, setPrev] = useState(x); if (prev !== x) { setPrev(x); … }`);
  setState in async/subscription callbacks is fine. No components defined
  during render — use plain render helper functions (`sortHeader(...)`).
- **The grid is memoized; keep it that way.** Focus-driven highlights
  (active column, find match) are applied by toggling CSS classes on DOM nodes
  directly — a focus move must never re-render hundreds of `ScoreCell`s.
- **The selection engine lives OUTSIDE React** (Phase 2, `gridSelection.js`
  pure model + `GridSelectionLayer` imperative shell). Selection paints as
  ONE absolutely-positioned overlay (O(1) per change, under the sticky
  panes); the model follows DOM focus via `focusin`; selection chords run on
  a capture-phase listener so `ScoreCell` needs ZERO new props. Range
  mutations funnel through `applyBulkWrite`: commit-active-cell-first, one
  transactional `/api/scores/bulk` call, one shared-map commit
  (`bulkUpdateScores`), one undo entry with bulk images both ways.
  Structural changes collapse the selection — never remap a rectangle.
  Cross-component wiring uses `data-*` contracts:
  `data-cell="score|max"`, `data-col`, `data-col-head`, `data-max-for`,
  `data-student-row`, `data-period-head`, `data-rename-assessment`,
  `data-autofocus`, `data-modal-close`, `data-att-row`.
- **Saves are optimistic + debounced.** `useAutosave` (400ms, module-level
  registry so Ctrl+S can `flushAutosaves()`); failures roll back to the last
  server-confirmed value with an error toast. Commits (blur/Enter) push ONE
  undo entry per edit session via `useHistory` (Ctrl+Z/Ctrl+Y).
- **Writes that change nothing must write nothing.** Update-by-id goes
  through `db.updateRow` (compares submitted fields against the current row —
  integer cents for numerics — skips entirely when nothing changed, stamps
  `updated_at` once otherwise); the score and attendance-config upserts carry
  the same guard, and the reorder loops always did (`AND sort_order != ?`).
  A no-op save that re-stamps `updated_at` re-enters LWW and can beat a REAL
  edit from the other laptop (this happened: the attendance page re-PUTs
  `max_score` on every save). Deliberate exception: a conflict restore
  re-stamps unchanged-looking data so it wins everywhere
  (`restoreConflictLoser` stays on a raw UPDATE).
- **Keyboard shortcuts** go through `useHotkey` (exact modifier matching,
  typing-target guard). App-wide keys mount once in `GlobalShortcuts`.
- **Every UI dimension constant** lives in `src/lib/uiConfig.js`. Note the
  documented coupling: `NUM_COL_WIDTH_PX` must equal `.sticky-col-2`'s `left`
  in `globals.css`.
- **Names:** `displayName()`/`searchText()` from `src/lib/names.js` are the
  ONLY way to render/search a student name ("Last, First MI. Suffix"; suffix
  never sorts). Sorting is `last, first, middle` COLLATE NOCASE everywhere.
- Comments explain WHY (the trap avoided), not what. Root-cause fixes only —
  no masking symptoms; this is a hard project rule from the owner.
- Direct pushes to `main` (no PRs). Commit messages are thorough; they end
  with `Co-Authored-By:` trailer of the authoring agent.

## 12. UI conventions

- Desktop-native register: right-click context menus (keyboard navigable) +
  a `⋮` fallback button — never rows of per-item icon buttons.
- Dialogs: `Modal` (portal, focus trap, Esc closes topmost only, focus
  restore, `data-autofocus`); `ConfirmDialog` focuses the primary button so
  Enter confirms. Deletes are safe (recycle bin) — no double confirmations.
- Excel is the mental model in the gradebook: cell selection selects content,
  arrows/Enter/Tab/Home/End/PageUp-Down navigation, Ctrl+Home/End corners,
  F2 renames, Delete clears, Esc cancels an edit, drag/double-click column
  resize, Ctrl+F find, Shift+F3 case cycling, checkbox multi-select for bulk
  actions. Ranges (Phase 2): Shift+Arrow / Shift+Click / drag extend,
  Ctrl+A all cells, Ctrl+Space column, Shift+Space row, click a # cell for
  its row, Delete clears a range (one undo entry), Esc collapses; a stats
  pill (cells · avg · high · low · missing) shows while a range is active.
  Clipboard (2b): Ctrl+C/X/V speak TSV with Excel/Sheets/LibreOffice via
  native copy/cut/paste EVENTS (no permission prompts; single-cell keeps the
  input's native behavior). Paste placement: selection divisible by the data
  shape in both dims → tile (covers scalar-fills-selection); else block at
  the selection's top-left, clipped at grid edges. Empty tokens clear,
  non-numeric tokens skip their cell; >5 replacements, clipping, or skips
  raise the paste-preview dialog (Enter confirms). Cut pastes as a MOVE
  (source clears in the same undo entry); marching ants mark the source
  (SVG dash animation), retired by paste-of-a-cut, Escape, or any
  structural change. Bulk writes run the attendance-source hook — pasted
  scores mark Present exactly like typed ones. Fill (2c): Ctrl+D fills the
  selection's top row down (single cell: copies the cell above; blanks fill
  as clears); the corner drag-fill handle repeats the selection down or
  right with a dashed preview (values repeat — sequences are a future
  step); Ctrl+Arrow jumps the active cell to the grid edge and
  Ctrl+Shift+Arrow extends there; selection and fill drags auto-scroll at
  the container edges (rAF loop re-hit-tests while the pointer holds
  still).
- Period-closing (3a): "missing" = blanks in ACTIVE columns only (any
  student has a value — the class took it); amber count chips on student
  names; "Fill blanks with 0" on a column (cell right-click — all its
  blanks) and on a period band (active columns only), >5 cells confirms
  first, always ONE undo entry; a weights chip appears on the period band
  when assessment weights don't total 100 (renormalization stays, it just
  stops being invisible); the Stats footer (toggle in the header,
  device-persisted) pins two sticky-bottom rows — class average per column
  (High/Low/Median + entered-count in the tooltip) and missing counts;
  Views are non-destructive lenses (with-missing-work / below-threshold
  with an inline view-only 75 default / rank by grade) whose membership
  and order FREEZE on apply so rows never jump mid-entry — the # column
  always shows canonical roster numbers, and the amber "N of M" chip
  restores. The failing threshold is a view setting, never grade policy.
- Rollover & focus (3b): Home → right-click a subject → "Start new term
  from this…" (POST /api/subjects/[id]/rollover — one transaction of
  ordinary inserts: structure + attendance config always, roster
  empty/copy/group, dated columns and scores NEVER; exam keeps its one
  undated auto-column; PH term defaults in src/lib/term.js). Student focus
  (double-click a name or its context menu) opens a right drawer built by
  the pure src/lib/studentFocus.js model — per-period grades, entry chips
  with P/L/A letters mapped through the period's attendance config, and
  the missing list under the same active-column rule as the chips.
  Deliberately deferred there: printable slip (print pack), student notes
  (synced data — needs the schema + snapshot discussion), per-cell history
  (the app stores none by design).
- Polish v1.7.0, the load-bearing details: the right-clicked row stays
  slate-tinted while its menu is open (gb-menu-row, imperative); the sticky
  proxy scrollbar's thumb is native-proportional (spacer = track ×
  content/viewport) and the grid container's own bar is hidden — ONE
  horizontal scrollbar; a document-level wheel guard prevents focused
  number inputs from spinning while forwarding the scroll (grades are
  wheel-proof, numeric semantics kept); THE UNDO SPLIT — ordinary text
  fields get native Ctrl+Z/Y and the EditTextMenu right-click menu
  (VS Code-style, works in browser dev too), grid cells keep the Excel
  session model (useHistory skips editable targets outside
  .gradebook-table); the toolbar is clustered Office-style (View popover ·
  history · frequent actions · ⋯ overflow) with a width-tier collapse;
  missing-highlight toggle (gb-hide-missing, chips unaffected,
  device-persisted); Focus Assessment mode renders the SAME ScoreCells in
  a modal — navigation scopes to the nearest [data-grid-scope], never
  cross-talking with the grid behind it.
  Deliberate deviations, documented: Home/End = first/last student in the
  COLUMN, PageUp/Down = horizontal period paging, column select is
  keyboard/context-menu (date headers are editable — editing wins).
- Quiet chrome: no page subtitles; the status bar hides inside the gradebook;
  hints are tiny gray text, not banners; accent tints are subtle
  (blue = active/hover, amber = attention/conflict, green = kept/success).
- Toasts bottom-right, self-dismissing; persistent cards (conflict watcher)
  only for things that must not be missed.
- New-feature affordances follow existing patterns first (`AGENTS.md` §11–12
  before inventing a new interaction).

## 13. Never change without discussion

1. **`engine.mjs` merge semantics** — LWW key, tiebreak, natural keys,
   tombstone rules, whole-row wins. The 60-scenario lab is the contract.
2. **`updated_at` semantics** — stamped by the editing device at edit time;
   merges preserve it; restores deliberately re-stamp (that's what makes a
   restore win). Nothing else may rewrite timestamps.
3. **Snapshot `SCHEMA_VERSION` bump rules** (§6) and `SYNCED_TABLES` defaults.
4. **No hard deletes / no `INSERT OR REPLACE`** on synced tables. Ever.
5. **`schema.mjs` stays a static import**; no new dynamic fs reads in server
   code without updating tracing excludes + the build guard.
6. **`package.json` dependency split** (deps = electron-updater only).
7. **`--publish never` + script-owned publishing.**
8. **The data dir / sync folder separation** (`validateSyncFolder`).
9. Migration rules: additive, guarded, single IMMEDIATE transaction.

## 14. Known limitations (accepted, documented)

- **Whole-row LWW**: two laptops editing different FIELDS of the same row
  (e.g. one fixes a first name, the other the suffix) → one overwrites the
  other; it lands in conflict review. Per-field merge was consciously rejected
  as complexity>benefit for this workload (scores are single-value rows).
- **Wall-clock dependency**: newest-wins trusts device clocks. Skew >5 min is
  detected and warned about, not corrected.
- Conflict log is per-laptop (not synced) and capped at 500.
- Attendance has three statuses (P/L/A mapped to scores); no Excused — adding
  one is a data-model change (config + mapping + snapshot bump).
- Designed for two devices; the merge handles N, but UX assumes "the other
  laptop".
- Windows/NSIS is the only packaged target.
- Restoring a score on a counts-as-attendance column intentionally does NOT
  re-fire attendance mirroring.

## 15. Extension points

- End-of-semester: printable reports, semester archiving, grade sheets — the
  Excel/PDF export routes are the starting point (export math is verified
  against real spreadsheets; keep it that way).
- More attendance statuses (see §14).
- Conflict review: bulk restore, filters; group-page banner (subject banner
  exists).
- The `useHotkey`/`GlobalShortcuts` system makes new shortcuts one-liners.
- `uiConfig.js` + CSS variables make grid sizing/theming centralized.
