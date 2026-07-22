# CLAUDE.md — Long-Term Project Memory

This file records the **philosophy, taste, and reasoning** behind Faculty
Gradebook — the things that don't show up in code but decide what code gets
written. Technical mechanics live in `AGENTS.md`; orientation in
`PROJECT_HANDOVER.md`. Read this before proposing anything.

---

## Project philosophy

How this application is intended to feel:

- **Desktop-first.** This is a professional Windows productivity tool, not a
  website in a frame. Window state is remembered, shortcuts exist, dialogs
  behave like native dialogs, Alt+Tab shows where you are.
- **Offline-first, always.** Every feature works with zero connectivity.
  Network (a cloud-synced folder, GitHub Releases) only ever adds convenience.
- **Reliability over cleverness.** Boring, deterministic, testable mechanisms
  beat elegant theory. "Data integrity is much more important than minimizing
  implementation complexity" — the owner, verbatim.
- **Sync disappears into the background.** It runs at launch, periodically,
  and at quit; it never blocks, never asks questions mid-flight, and surfaces
  only outcomes (a toast, a badge) — never mechanics.
- **Zero configuration, no accounts.** Two laptops, one shared folder, a
  friendly per-device label ("name this laptop"). Nothing to sign into,
  nothing to administer.
- **Teacher-first.** The gradebook grid is the workplace; everything else
  (settings, sync, maintenance) stays out of the way. Terminology is the
  teacher's (subject, grading period, quiz, attendance) — never the
  developer's (rows, tables, merge).
- **Deterministic behavior.** The same actions produce the same state on both
  laptops, in any order. Convergence is a guarantee, not a hope.
- **Data safety over convenience.** Per-launch backups, tombstones instead of
  deletes, a recycle bin, a conflict log that keeps BOTH versions, restore
  instead of regret. Nothing is ever silently lost.

## User preferences (learned over the project's lifetime)

The owner is an instructor who uses the app daily on real grades, tests
releases immediately on two laptops, and reads code-level explanations with
full understanding. Preferences, consistently demonstrated:

- **Root causes, not workarounds.** When something is wrong, the expected
  response is an investigation and a causal explanation, then the fix. Blind
  exclusions, masking symptoms, or "try this" guesses are rejected ("investigate
  the root cause instead of guessing", "fix the root cause rather than masking
  the symptom").
- **Analyze before implementing.** For any nontrivial feature: first check
  whether something similar already exists and extend it; present the analysis
  and a recommendation; implement after agreement. Duplicated mechanisms are a
  smell.
- **Batch development.** Work ships as themed batches (a UX batch, a sync
  batch), each fully verified, each becoming one release.
- **Verification is non-negotiable.** Lint, tests, build, and proof (byte-exact
  export comparisons, two-instance lab runs, remote blob SHA checks) before
  anything is pushed. The owner once had grade math verified cell-by-cell
  against a real exported spreadsheet.
- **Excel is the reference UX.** Grid navigation, cell selection, column
  resizing, F2, find, bulk selection — when in doubt, do what Excel does.
- **Minimalist interfaces.** Subtitles were removed app-wide; the status bar is
  hidden in the gradebook; "the subtle cell bg is enough, remove the line".
  Every pixel of chrome must earn its place.
- **Right-click menus over icon clutter.** Permanent per-row action icons were
  explicitly replaced with context menus + a single `⋮` fallback.
- **Keyboard shortcuts matter** — and they should be centralized so new ones
  are cheap to add.
- **Dislikes unnecessary dialogs and confirmations.** Confirmations exist only
  where consequences are real; deletes go to a recycle bin so they don't need
  scary prompts. (Exception, requested explicitly: restoring a conflict —
  a final confirmation that states exactly what will happen.)
- **Consistency over flash.** New UI must match existing patterns; a "shared
  constant" is preferred over a magic number in one file.
- **Rejects complexity that doesn't solve a real problem** — accounts, servers,
  CRDTs, per-field merge were all considered and declined (see below).
- **Long-term maintainability first.** Wants documentation to reflect new
  logic ("stale documentation causes failures"), constants centralized,
  test suites permanent.
- **Wants to be taught.** For unfamiliar operations (GitHub releases, tokens),
  walk through steps in sequence, explain *why*, and give exact commands.
  PowerShell on Windows is the environment (`setx` quirks, terminal restarts).
- **Security basics respected:** tokens live in env vars, never in chat, never
  in code, always scrubbed from output. (A token was once pasted in chat — it
  was revoked immediately; never let that happen again.)
- **Never repurpose or overwrite an existing resource** (base, file, release)
  without being asked; when a specified resource can't be found — stop and ask.

## UX principles (recurring, settled patterns)

- Context menus (keyboard-navigable) instead of permanent action buttons.
- Undo (Ctrl+Z per edit session) instead of confirmation dialogs.
- Restore instead of permanent delete — recycle bin for subjects/groups,
  conflict review for sync decisions, backups for disasters.
- Small, focused modals with a real focus trap; Enter = primary action,
  Esc = one layer at a time.
- The gradebook is the primary workspace: it gets sticky columns and header,
  a docked horizontal scrollbar with period jump buttons, find, keyboard
  everything — and NO status bar, banners only when something needs review.
- Reduce teacher clicks: mark-all-present then exceptions; auto-advance after
  marking attendance; score → auto-Present mirroring; one-step "save roster as
  group".
- Settings stay out of the main workflow (bottom status-bar gear; tabs:
  General / Synchronization / Sync Conflicts / Recently Deleted / Backups).
- Visual context over technical terminology: conflicts are shown as a
  miniature gradebook with the neighbors around the cell, not as JSON rows;
  laptops have friendly names; dates render as "July 8, 2026".
- Conflict review shows SEMANTIC conflicts only — an entry exists to demand
  a decision. If both laptops produced identical gradebook data (no-op
  re-saves, the same value entered twice, both deleting the same thing),
  nothing is surfaced; timestamps, ids, and device attribution never create
  a review item. Corollary: every entry that IS shown must display its
  difference in the details view.
- Empty states teach the next step in one short sentence.
- Amber = needs attention, blue = active/informational, green = kept/success;
  red is reserved for destructive actions and errors (a FINAL grading period
  is purple, deliberately not red).

## Architectural principles (the "why" behind big decisions)

- **Why SQLite replaced MySQL:** the app must run on a laptop with nothing
  installed — no service, no port, no credentials. One file to back up, WAL
  for safe concurrent reads, synchronous better-sqlite3 keeps query code
  simple. The old import script is kept for history.
- **Why Electron + an embedded Next server:** the entire product was already a
  working Next.js web app; wrapping the REAL server (standalone output) means
  the browser and desktop products are literally the same code, and the UI
  talks HTTP either way. No IPC-based data layer to maintain.
- **Why snapshots in a shared folder instead of a server:** the two-laptop
  workflow already had a shared folder (cloud drive). Full-state snapshots are
  trivially debuggable (a .json.gz you can open), atomic to publish, immune to
  partial-sync states, and need zero infrastructure. Deltas/oplogs were
  rejected: more moving parts, harder recovery, no benefit at this scale.
- **Why Last-Write-Wins with row granularity:** grading is overwhelmingly
  disjoint (different cells, different times). Real same-cell conflicts are
  rare and now fully recoverable via the review log. LWW + deterministic
  tiebreak gives guaranteed convergence with code a human can audit.
- **Why NOT CRDTs:** convergence was achievable with per-key max under a total
  order. CRDT libraries would add dependency weight, opaque internals, and a
  new mental model — for zero additional guarantee here.
- **Why conflict review happens AFTER sync, never during:** syncs run headless
  (launch/periodic/quit — nobody is watching). Blocking on questions would
  extend divergence windows and could get different answers on each laptop.
  Converge first, then let the human override with a normal edit.
- **Why no accounts:** two trusted colleagues on their own laptops. Device
  identity (a UUID + friendly label) covers attribution ("Owner: other
  laptop", "edited on X") without passwords, sessions, or servers.
- **Why row-level merge is sufficient:** the one entity users co-edit is a
  score — a single value. Per-field merging would help only rare name-edit
  races and would complicate every table's semantics.
- **Why simplicity wins:** every mechanism in this app can be explained to its
  user in one paragraph. That property is treated as a feature and defended.

## Current roadmap

**Completed (shipped, verified):**
- MySQL → SQLite migration; versioned, concurrency-safe schema migrations (v8)
- Electron desktop shell: splash, window-state + zoom persistence, single
  instance, backups on launch, 90s cold-start tolerance
- Offline sync: full-state snapshots, LWW merge, natural-key twin adoption,
  tombstones, basis-driven conflict log, clock-skew warning, mixed-version
  forward compatibility
- Conflict review UX: toast after any sync, badge, review tab,
  gradebook-language details with miniature-grid comparison, restore-as-new-edit
  with confirmation (v1.0.7–v1.0.8)
- Recycle bin (subjects/groups) with sync-correct restore/purge
- Auto-updates via GitHub Releases (public repo), script-owned idempotent
  publishing
- Gradebook: live period/final grades (integer-cents math), undo/redo,
  spreadsheet keyboard model, resizable name column, sticky scrollbar dock with
  period jumps, Ctrl+F find, column/row highlights, Excel/PDF export
  (math verified byte-exact)
- Attendance: quick entry with full keyboard flow, score mapping config,
  same-date reuse, counts-as-attendance mirroring (real-time in the grid)
- Students & groups: suffix support end-to-end, Excel import, reusable groups,
  group-from-subject, add-student-to-group, drag reorder, text-case tools
  (Shift+F3 + bulk multi-select)
- Desktop conventions batch: dialogs (focus trap, Enter/Esc), keyboard context
  menus, dynamic window titles, Ctrl+S flush, F2 rename, Home/End, custom
  scrollbars, subtitle cleanup
- Permanent test suites: 59 engine + 48 grid-selection + 48 formatting +
  71 scenario + 25 class-stats + 14 recycle + 55 workflow + 34 window-state;
  `no-undef` lint (caught a real shipped bug)
- Semantic conflict review + centralized no-op write guards (v1.0.9): the
  log only surfaces real data divergence (`sync/review.mjs`); saves that
  change nothing no longer stamp `updated_at` (`db.updateRow` + upsert
  guards), which also removed an LWW hazard where a ritual re-save could
  beat a real unseen edit. Release publishing survives slow uploads
  (streamed `node:https`, adopt-if-landed, retry)
- Notes, coloring, codes + the focus-jump root fix (v1.8.0): the Modal
  focus-trap defect diagnosed at the root (its effect re-ran on every
  parent render because `onClose` — a fresh arrow — was a dependency, and
  the teardown "restored" focus to a stale cell; the trap now mounts once
  per open via an onClose ref, hardening EVERY dialog). Configurable cell
  coloring: a rules registry (missing / zero / failed score / failed
  period + final grades / over max) with owner-requested priority
  reordering — first enabled match wins; per-rule colors + thresholds in
  Settings → Cell Coloring; device-local; the missing rule IS the View
  toggle. Automatic assessment short codes (Q1 A1 AS1 L1 AT1 SW1, exam E)
  derived from column order — never stored, renumber by construction; a
  toggleable fifth header row. FREE-FORM NOTES — the project's FIRST
  schema + snapshot bump (DB v7→v8, snapshot v5→v6, the §6 ceremony in
  full): one polymorphic synced `notes` table (natural key entity_type +
  entity_id; cell notes `columnId:studentId`; student/subject levels
  data-model-ready; subject_id denormalized → one-query loads +
  search-ready), notes INDEPENDENT of the score lifecycle per owner
  refinement (a blank cell keeps its note until the note is deleted),
  Excel corner-triangle indicators + hover tooltips at the td level
  (ScoreCell still zero new props), right-click Add/Edit/Delete on cells
  and date columns, multiline editor (Ctrl+Enter), Level-2 undo on every
  note write, conflicts reviewed in gradebook language
- Data-safety patch (v1.7.2): TWO-MODE score cells — ready (readOnly,
  nothing selected, stray keys harmless; empty cells still type-to-enter
  so entry speed is untouched) vs intentional edit (double-click / F2 /
  Delete); filled cells flash "locked" on stray keys. The dock scrollbar
  became a custom-drawn track + thumb with fixture-tested native
  arithmetic (draggable, page-on-click, wheel) — the proxied-scrollbar
  spacer trick and its visual artifacts are gone. Focus modal overflow
  cleaned (fixed table layout)
- Fixes & edge cases (v1.7.1, first SemVer patch): the THREE-LEVEL recovery
  model — cell editing always undoable; gradebook structure undoable
  wherever possible (imports, roster edits, removals — batch remove/revive
  cycles the SAME rows); outside-the-gradebook stays with its own systems
  (recycle bin, conflict review). Retroactive counts-as-attendance
  (enabling backfills existing scores through the same blanks-only hook;
  disabling stays inert). Dock-aware layout (in-flow spacer + the stats
  footer pins above the scrollbar dock). One toggle, one visual system for
  missing cues. Semantic Versioning adopted and documented in AGENTS.md §9
- Polish batch (v1.7.0): context-menu row highlight; native-proportional
  sticky-scrollbar thumb with the container's own bar hidden; wheel-proof
  number inputs (owner chose keeping numeric semantics over text inputs —
  a document-level guard kills the spin and forwards the scroll); the undo
  split (native text editing + EditTextMenu everywhere, Excel session undo
  stays in the grid); Office-style adaptive toolbar with the View popover
  (left sidebar explicitly rejected: grid width wins); missing-highlight
  toggle; Focus Assessment mode (same ScoreCells, [data-grid-scope]
  navigation); remove-imported-group by name identity with dry-run
  preview; subject list count + combined term + persisted sort
- ROADMAP Phase 3b — rollover + student focus (v1.6.0): the semester
  rollover wizard (Home right-click → new term in one transaction —
  structure and attendance config always, roster empty/copied/from-group,
  dated columns and scores never; PH term sequence defaults) and the
  conference-mode student-focus drawer (double-click a name: per-period
  grades, entry chips with P/L/A letters, the missing list — pure model,
  zero new API; notes and the printable slip deferred by the house rules)
- ROADMAP Phase 3a — the period-closing cluster (v1.5.0): the active-column
  missing rule (blanks count only where the class has scores) with amber
  name chips; Fill-blanks-with-0 at column and period scope through the
  bulk pipeline (one undo entry, >5 confirms); the weights≠100 chip; the
  sticky two-row class-stats footer (avg + missing; High/Low/Median in
  tooltips; pass rate deliberately deferred until "passing" is policy
  data); frozen non-destructive views (missing work / below a view-only
  threshold defaulting 75 / rank by grade, canonical roster numbers kept)
- ROADMAP Phase 2c — fill, completing Phase 2 (v1.4.0): Ctrl+D fill-down
  (top row repeats; single cell copies above; blanks fill as clears), the
  Excel corner drag-fill handle with dashed extension preview (values
  repeat down/right; sequences deferred deliberately), Ctrl+Arrow /
  Ctrl+Shift+Arrow grid-edge jumps, and edge auto-scroll for selection and
  fill drags (rAF loop that re-hit-tests while the pointer holds still)
- ROADMAP Phase 2b — the clipboard (v1.3.0): TSV interop with Excel/Sheets/
  LibreOffice/Notepad through native copy/cut/paste events; Excel-true
  placement (divisible → tile, else block-at-anchor clipped at edges);
  empty clears / junk skips; destructive pastes preview first (>5
  replacements, clips, or skips); cut pastes as a move in ONE undo entry;
  SVG marching ants mark the source; /api/scores/bulk gained
  attendance-source parity so pasted scores mark Present like typed ones
- ROADMAP Phase 2a — the selection engine (v1.2.0): pure grid-selection
  model outside React (`gridSelection.js` + `GridSelectionLayer`), one-
  overlay rendering under the frozen panes, Shift+Arrow/Shift+Click/drag
  ranges, Ctrl+A / Ctrl+Space / Shift+Space / #-cell row select, range
  clear as ONE bulk write + ONE undo entry, selection stats pill; ScoreCell
  untouched (zero new props — the memoization contract held)
- ROADMAP Phase 1 — professional desktop feel (v1.1.0): "The Class Record"
  splash (embedded artwork, REAL boot stages, splash→app cross-fade via
  deferMaximize/showManaged), session restore (last subject + scroll +
  period, device-local, Settings toggle), context-rich window titles with
  the live grading period, Segoe UI + tabular numerals app-wide, sync
  staleness sentinel (`stale` + `last_sync_run_at`) with the ambient
  "Synced X ago · peer seen Y" home line, and the two-animation motion
  vocabulary (modal pop, toast rise)

**Planned / candidate next steps (discussed, not committed):**
- End-of-semester pack: printable grade sheets/reports, semester archiving
- Excused attendance status (needs data-model + snapshot bump discussion)
- Conflict review niceties: bulk restore, group-page banner
- Keyboard cheat-sheet artifact for the two laptops
- npm audit review of dev-tooling warnings (cosmetic, shipped app unaffected)
- Whatever daily use surfaces next — the owner drives priorities from real use
