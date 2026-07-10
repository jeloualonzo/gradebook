# PROJECT_HANDOVER.md

**To:** the next AI / engineer taking over Faculty Gradebook
**From:** the agent that built it alongside the owner, v0 → v1.0.8
**Repo:** `jeloualonzo/gradebook` (public) · **Current version:** 1.0.8

This is the orientation document. `AGENTS.md` is the technical handbook
(read it in full before your first change). `CLAUDE.md` is the taste and
philosophy record (read it before your first proposal). This file tells you
where the project stands, what's fragile, what's deliberate, and what I'd do
next in your position.

---

## 1. What this is

A production Windows desktop gradebook used **daily, on real grades**, by two
instructors sharing two laptops. Philippine academic structure (PRELIM /
MIDTERM / FINAL, weighted; sections like "BSIT 2A"; names as
"Last, First MI. Suffix"). Offline-first; syncs through a shared folder;
auto-updates from GitHub Releases. There is no server, no account, no cloud
database — and that is a feature, not a gap.

Treat it as production software: real data, real users, mistakes visible on
Monday morning.

## 2. Current architecture in one breath

Next.js 16 (App Router, React 19, Tailwind 4) web app; ALL data access through
its API routes into better-sqlite3 (WAL, UUID keys, ISO-UTC `updated_at`).
Electron boots the compiled standalone Next server as a child process on a
free localhost port and wraps it in a native shell (window state, backups,
sync scheduling, auto-update). Sync = full-state gzip snapshots per device in
a shared folder, merged by a pure LWW engine with natural-key twin adoption,
tombstones, and a basis mechanism that logs true conflicts locally for
after-the-fact review and one-click restore.

Database version: 7 (PRAGMA user_version). Snapshot compatibility version: 5
(separate on purpose — see AGENTS.md §6; confusing these is the classic error).

## 3. Important workflows (as the users live them)

- Morning: open laptop A → launch sync pulls the other laptop's work → grade in
  the grid (autosave 400ms, undo per cell-session) → close → quit sync
  publishes. Afternoon: laptop B does the same. No manual sync in the normal
  path; "Sync now" exists in Settings for impatience and testing.
- Attendance: Quick Attendance page (mark-all-present, exceptions by keyboard,
  P/L/A auto-advance) or "counts as attendance" — scoring a flagged quiz column
  auto-marks Present for that date, mirrored live into the open grid.
- Conflicts: if both laptops edited the same thing offline, sync keeps the
  newest, logs both versions, toasts + badges; review in Settings → Sync
  Conflicts with a miniature-gradebook comparison; Restore writes the old value
  back as a normal edit that syncs out.
- Releases: owner runs `git pull` + `npm run desktop:release` on Windows; both
  laptops pick the update up automatically.

## 4. Completed milestones

MySQL→SQLite; Electron shell; snapshot sync + hardening (natural keys,
tombstones, basis conflict log, clock-skew warning, mixed-version compat);
recycle bin; conflict review UX with details view; auto-update pipeline
(script-owned publishing after electron-builder's racy publisher burned us);
grade math verified byte-exact against a real export; full desktop-conventions
pass (window/zoom persistence, dialogs, shortcuts, F2/Ctrl+F/Ctrl+S, custom
scrollbars, sticky scrollbar dock with period jumps, resizable name column);
attendance workflows; student groups + text-case tooling; five permanent test
suites (148 checks total) + strict lint.

## 5. Remaining roadmap (candidates, owner decides)

End-of-semester reporting/archiving (most likely next), Excused attendance
status (needs schema + snapshot-version discussion), conflict-review bulk
actions, shortcut cheat sheet, dev-dependency audit pass. Nothing is urgent;
the app is feature-complete for daily grading.

## 6. Biggest technical risks (ranked)

1. **The ABI/tracer/materialization trio in the build** (AGENTS.md §8). The
   three past disasters — Electron-ABI sqlite under Node, tracer globbing the
   repo into a 1.5 GB installer, writes-through-hardlinks corrupting real
   node_modules — are each guarded in `build-desktop.mjs`. If you touch the
   build, re-read those guards first; they encode pain.
2. **Merge-engine edits.** Any change to `engine.mjs` or `updated_at`
   semantics can silently destroy convergence. The 44-scenario lab is the
   safety net — run it for ANY sync-adjacent change, no exceptions.
3. **Schema changes on synced tables.** Forgetting `SYNCED_TABLES` defaults or
   the snapshot version bump breaks mixed-version laptops mid-upgrade (we hit
   `NOT NULL constraint failed: subjects.subject_code` in the wild once;
   `pickColumns` defaults exist because of it).
4. **Wall clocks.** LWW trusts them. Skew is detected (>5 min) and warned, not
   fixed. If the users ever report "wrong value won", check clocks first.
5. **The publish flow.** GitHub releases require the tag first; partial
   uploads must be repaired by re-running (the script is idempotent by
   design). Never re-enable electron-builder's own publisher.

## 7. Things intentionally avoided (do not "fix" these)

- No accounts, no auth, no server, no websockets, no CRDT library.
- No ORM; hand-written SQL in `src/lib/queries/*` on purpose.
- No test framework; plain Node scripts with explicit assertions.
- No per-field merge; no operational-transform ambitions.
- No hard deletes on synced tables; no `INSERT OR REPLACE` anywhere near them.
- No PR workflow — direct, fully-verified pushes to `main`.
- No native find dialog, no default Electron menu reliance — shortcuts are
  owned by the app so they can be documented and tested.

## 8. Testing philosophy & commands

Prove data integrity with executable scenarios; prove UI with lint + build +
targeted SSR harnesses; prove releases by checking the actual uploaded assets.

```bash
npx eslint src/ scripts/ --quiet          # includes no-undef (caught a real bug)
node scripts/test-sync-engine.mjs         # pure merge (38)
node scripts/test-window-state.mjs        # window/zoom keeper (30)
BUILD_STANDALONE=1 npx next build         # Node-ABI standalone for the lab
# two instances: GRADEBOOK_DATA_DIR=/tmp/sync-lab/{a,b} PORT=3131/3132 node server.js
node scripts/test-sync-scenarios.mjs      # two-laptop lab (44)
node scripts/test-recycle-bin.mjs         # (14)   node scripts/test-workflows.mjs  # (22)
node scripts/build-desktop.mjs --no-pack  # desktop bundle sanity
```

Release (owner's machine, PowerShell): `git pull; npm run desktop:release`
with `GH_TOKEN` in the environment (classic PAT, `repo` scope; new terminals
only see it after a full restart).

## 9. Before changing ANYTHING, know these

- The two version numbers (DB v7 vs snapshot v5) and when each bumps.
- Why `schema.mjs` is a static import (tracer disaster) and why the build has
  a junk guard.
- Why sync applies with chained `ON CONFLICT` upserts and never REPLACE
  (CASCADE would eat children).
- That the grid's performance model relies on memoized cells + imperative DOM
  class toggling — a casual `useState` in the wrong place makes 40×200 cells
  re-render per keystroke.
- That react-hooks v6 lint forbids sync `setState` in effects — the codebase
  uses the render-time adjustment pattern everywhere; follow it.
- That the working directory in shells persists between commands — one release
  step once edited `.next/standalone/package.json` instead of the real one.
  Always `cd` explicitly in automation.
- That the owner expects: analysis before implementation, root causes, full
  verification, and honest commit messages that explain WHY.

## 10. Lessons learned (the expensive ones)

- **Windows standalone output links back into node_modules.** Writing
  "through" it corrupts your dev tree. Materialize first. (Cost: a corrupted
  sqlite binary and an afternoon.)
- **A bare `require()` can't detect ABI mismatch** — you must construct a
  `Database`. Half-checks pass and then production fails.
- **electron-builder publishes from two parallel tasks** → duplicate-release
  races and half-uploaded releases. Own your publish step.
- **`setx` doesn't update existing terminals.** Walk users through restarting
  the terminal, or auth mysteriously "doesn't work".
- **GitHub masks permission errors as 404s** on release APIs when the token
  lacks `repo` scope.
- **Same-cell rows created independently on two devices** crash naive sync
  with UNIQUE violations forever — natural-key matching + id adoption was the
  durable fix, not deleting a row by hand.
- **Conflict logs over-trigger without a true common ancestor** — the basis
  mechanism (peer declares which of MY exports it absorbed) is what separates
  real conflicts from ordinary propagation. Guard it.
- **Multiple build workers WILL race your migrations** — the single IMMEDIATE
  transaction with version re-read exists because `SQLITE_BUSY_SNAPSHOT`
  killed builds.
- **Next lint doesn't include `no-undef`** in JS projects; a shipped
  ReferenceError (crashed the group page) proved why we enable it.
- **Deliberate UX delays feel like bugs** — a 1.2s post-save toast pause read
  as "slow"; navigate immediately, confirm passively.

## 11. Common mistakes a new contributor would make

- Bumping the snapshot version for a local-only table change (or forgetting
  the bump + defaults for a synced one).
- Adding a confirmation dialog where undo/recycle-bin already covers the risk
  (the owner will reject it).
- Rendering a helper as a nested component, or `setState` synchronously in an
  effect — lint blocks both; use the established patterns.
- Editing generated `.next/standalone` files or running the lab against an
  Electron-ABI bundle.
- Introducing a dependency into `dependencies` (it must stay
  `electron-updater` only; everything else is a devDependency).
- Pushing without the blob-SHA verification habit, or with a stale
  `package-lock.json`.
- Using `pkill` by name against the lab servers (the process renames itself;
  use saved PIDs).
- Writing student names by hand instead of `displayName()`.

## 12. Recommended development priorities

1. Whatever daily use surfaces — the owner reports precisely and quickly.
2. End-of-semester pack (reports/archiving): highest real-world value next.
3. Keep the conflict-review loop polished as real conflicts occur — it's new.
4. Occasional housekeeping: dev-dep audit, Electron/Next upgrades done
   deliberately (upgrade one thing at a time; rerun the FULL lab).

## 13. Overall assessment

Honest status: **stable, coherent, and genuinely finished for its core job.**
The data layer is the strongest part — migrations, sync, conflict handling,
and backups are tested to a level unusual for a project this size (148
permanent checks, two-instance integration lab, byte-exact export
verification). The desktop experience now matches native conventions. The
riskiest area is the build/release pipeline, purely because it encodes many
hard-won platform workarounds — it works reliably, but read before touching.
Code quality is consistent; comments explain intent; constants are
centralized; the owner enforces the discipline as much as any linter.

## Advice to the Next AI

**Respect the merge engine.** It is small enough to read in ten minutes —
read it, then treat it like a load-bearing wall. Every guarantee the users
rely on ("we can both grade offline and nothing is lost") flows from those
~200 pure lines plus the timestamps feeding them. Extend around it (the
conflict review did exactly that); do not extend *into* it.

**The simple parts are intentionally simple.** Full-state snapshots, LWW,
plain SQL, no framework tests, no accounts — each of these was chosen over a
"better" alternative with open eyes. If a redesign itch strikes, re-read the
architectural principles in CLAUDE.md first; the owner has already litigated
most of these trades and will ask you the same questions.

**The deceptively complex parts are the build pipeline and the sync edge
cases.** `build-desktop.mjs` looks like ~400 lines of ceremony; every stanza
is a scar (ABI, tracer, hardlinks, racy publisher, token hygiene). The sync
engine looks trivial; its correctness lives in the details — tombstones,
natural-key adoption, basis logging, updated_at ownership — and in the
scenario lab that pins them down.

**Avoid rewriting: the grid.** GradebookTable + ScoreCell embody a
performance model (memoization + imperative DOM signals + debounced saves +
sessioned undo) that took iterations to get right and now feels instant with
hundreds of columns. Improve it incrementally; a "clean" rewrite will
rediscover each constraint the hard way.

**Invest future effort where the users live:** the grid, attendance, and the
end-of-semester moment. One well-verified workflow improvement there is worth
ten architectural refinements. Follow the house rhythm — analyze, propose,
agree, implement, verify (lint → suites → lab → build → push → SHA check),
release, and write commit messages that teach. The owner is the best QA you
will ever have: precise, fast, and unforgiving of hand-waving — earn the
trust by showing your work, and this project is a joy to build on.
