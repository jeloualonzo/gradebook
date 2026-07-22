# ROADMAP.md — Gradebook v2 Master Vision

**Status:** canonical product vision, owner-authored (2026-07-10). Amendments in
Appendix A were proposed by the implementing agent and **agreed by the owner**
the same day. Consult this document before proposing or implementing ANY
improvement. `AGENTS.md` (how to change things safely), `CLAUDE.md`
(philosophy/taste), and `PROJECT_HANDOVER.md` (orientation) still apply in full.

**The goal, verbatim:** a teacher opening the application for the first time
should think *"this feels like Microsoft Office, Visual Studio, or Adobe
software — not a website running inside Electron."*

---

## How to use this roadmap (implementation strategy)

- Do **NOT** implement everything at once.
- Review this roadmap before every future improvement.
- Suggest the best next phase based on architectural impact and user value.
- Complete one phase fully before moving to the next — each phase must be
  architecturally clean, fully tested, polished, production-ready, and
  consistent with the existing offline-first architecture.
- Maintain backward compatibility and data safety at every step.
- If a better implementation exists than what is described here, explain why
  and recommend it **before** coding (Appendix A records such agreements).

**Always preserve:** offline-first philosophy · SQLite database · migration
system · synchronization engine · conflict resolution · Recycle Bin ·
autosave · keyboard-first workflow.

**Never sacrifice reliability for visual polish.**

---

## Phase 1 — Professional Desktop Feel

Make the application stop feeling like a browser.

**Startup experience.** Replace the plain loading window with a full
professional splash screen (inspiration: Office, Visual Studio, Adobe CC,
JetBrains, Notion, Figma). Premium branding, beautiful illustration or
abstract educational artwork, animated logo, smooth fade-in/out, modern
typography, elegant color palette, version number, build number, current
laptop/device name, and **real initialization stages** (Initializing… /
Starting server… / Loading database… / Checking synchronization… / Restoring
previous session… / Ready) instead of fake progress. Splash → main window
must be seamless. *(See Appendix A-1: calm premium, no particles.)*

**Window memory.** Remember window size, position, maximized state, zoom
level *(all four: already shipped)*, plus last opened subject, last grading
period, and last scroll position. Opening the app should feel like
continuing yesterday's work.

**Window title.** Context-rich titles, e.g.
`Programming Fundamentals — BSIS 3A — PRELIM — Faculty Gradebook`.

**Native desktop feeling.** Proper dialogs, proper context menus, smooth
transitions, natural animations, professional spacing — no obvious web-app
behaviors.

## Phase 2 — Excel-grade Interaction

Transform the gradebook into a real spreadsheet.

**Navigation:** arrows, Home/End, Ctrl+Home/End, PageUp/Down, Ctrl+Arrow,
Shift+Arrow, Shift+Click, drag selection, Ctrl+Click, Ctrl+A — selection
works exactly like spreadsheets.

**Selection engine:** a real selection model — single cell, row, column,
rectangular range; architecture future-ready for multiple ranges. **Build
this before any dependent feature.**

**Clipboard:** native TSV copy/cut/paste interoperable with Excel, Google
Sheets, LibreOffice, Notepad; paste preview when destructive.

**Fill:** Ctrl+D and drag-fill; future-proofed for sequence generation.

**Freeze panes:** Student Name frozen (shipped); future configurable
positions.

**Active selection visuals:** active row, active column, active header —
selection always visually obvious.

**Selection statistics:** Selected cells · Average · Highest · Lowest ·
Missing — shown only while a range is selected (Excel status-bar style).

## Phase 3 — Teacher Workflow

**Missing-work filters:** missing attendance/quiz/activity/exam, passing,
failing, incomplete — filtering only, never data modification.

**Student focus:** a dedicated per-student page — attendance, assessments,
grades, history, notes, printable summary. *(Notes = new synced data:
requires the schema + snapshot-version discussion before building.)*

**Semester wizard:** duplicate subjects/assessments/groups **without
grades** for a new term.

**End-of-semester tools:** transmutation, registrar exports, archiving,
printing, a finalization workflow.

**Class statistics:** per assessment — average, highest, lowest, median,
missing count, pass rate; compact display.

**Grade policies (as configuration, never formulas):** drop lowest quiz,
best-N activities, attendance cap, bonus points, late penalties, automatic
rounding. *(See Appendix A-4: landed one policy at a time.)*

## Phase 4 — Professional UI

**Typography:** Segoe UI where appropriate; tabular numerals for every
score; better spacing and hierarchy. **Color philosophy:** mostly
white/gray/neutral; color reserved for warnings, errors, selection,
conflicts, sync, success; grading-period colors become subtle. **Icons:**
one family, consistently — no Unicode mixed with SVG. **Assessment
headers:** redesigned for scanning *(see Appendix A-5: presentation, not
structure)*. **Grid polish:** borders, spacing, sticky headers/scrollbar,
assessment separation, hover/active feedback. **Fonts:** perfectly aligned
numbers; support long assessment names and subject titles.

## Phase 5 — Desktop Productivity

**Custom menu bar** (File · Edit · View · Gradebook · Synchronization ·
Help) with keyboard shortcuts — never Electron's default menu. *(See
Appendix A-2: custom DOM-drawn, VS Code style.)*

**Autosave status:** Saved / Saving… / Offline / Syncing… / Conflict —
never intrusive. **Sync status:** last synced, current device, other
device, sync health — no hidden sync state. **Recent activity:** recently
edited subjects, recent grades, recent attendance. **Better search:**
Ctrl+F across students, assessments, dates, subjects, groups — jump
directly. **Multiple subject tabs** *(see Appendix A-3: cached-switcher
semantics)*. **Smart warnings:** blank grades, weight issues, incomplete
grading, unsaved work, submission readiness. **Better printing:**
professional print preview — paper size, margins, orientation, page
preview, signature blocks, institution-ready layouts.

## Phase 6 — Analytics

Meaningful insights only: grade distributions, pass rate, score histogram,
attendance trends, student progress, risk indicators, class performance
over time. Help teachers understand performance — never overwhelm them.

## Phase 7 — Overall Polish

Continuously ask: *"Would Microsoft ship this? Would Adobe? Would
JetBrains?"* If no — improve it. Prioritize consistency, discoverability,
responsiveness, accessibility, keyboard efficiency, visual hierarchy, and
professional desktop feel over adding features.

---

## Appendix A — Agreed amendments (owner-approved 2026-07-10)

1. **Splash: premium and CALM.** Real stage text, quality still artwork,
   typographic polish, smooth fades — but no particles, no animated
   backgrounds, no glassmorphism. The inspiration apps themselves ship
   static brand plates; motion during a wait draws attention to the wait.
2. **Menu bar: custom DOM-drawn (VS Code style),** not Electron's native
   `Menu` template — full styling control, identical behavior in browser
   dev mode (where the test harnesses live), accelerators displayed.
3. **Subject tabs = editor-tab semantics:** a tab strip over cached
   per-subject state, one live grid at a time, instant switching,
   remembered scroll/period per tab — never simultaneous live documents
   (MDI). Composes with session restore.
4. **Grade policies land one at a time.** Each policy is a data-model +
   calculator + export-parity + sync decision; byte-exact export
   verification must hold after every one. Start with drop-lowest /
   best-N; the first two establish the policy architecture.
5. **Assessment headers: polish the presentation, keep the structure.**
   The existing 4-row header (period / assessment spanning its columns /
   dates / max) is the right information architecture; repeating the
   assessment name per column would regress scanning.

## Appendix B — Sequencing & status

| Phase | Status | Notes |
|---|---|---|
| 1 — Desktop feel | **shipped (v1.1.0)** | Splash ("The Class Record", real stages), session restore, contextual titles, Segoe + tabular numerals (P4 import), staleness sentinel + ambient sync line (P5 import), motion trio |
| 2 — Excel interaction | **COMPLETE (v1.2.0–v1.4.0)** | 2a selection engine + overlays + range clear + stats · 2b TSV clipboard, paste preview, marching ants, cut-as-move, bulk attendance parity · 2c Ctrl+D fill, drag-fill handle with preview, Ctrl+Arrow edge jumps, drag auto-scroll |
| 3 — Teacher workflow | **in progress — 3a (v1.5.0) + 3b (v1.6.0) shipped** | 3a period-closing cluster (missing chips, fill-blanks, weights chip, stats footer, frozen views) · 3b semester rollover wizard (structure always, roster by choice, scores never) + student-focus drawer (conference mode; notes/printable slip deferred by rule). Next: end-of-semester pack, grade policies |
| 4 — Professional UI | queued | Remainder after P1 imports |
| 5 — Productivity | queued | Menu bar, tabs, printing, digest |
| 6 — Analytics | queued | Insights, not dashboards |
| 7 — Polish | continuous — first dedicated batch shipped (v1.7.0) | Menu-row highlight, native-proportional sticky scrollbar (single bar), wheel-proof numeric inputs, the undo split + edit context menu, Office-style adaptive toolbar with View popover (sidebar considered and rejected — grid width wins), missing-highlight toggle, Focus Assessment mode, remove-imported-group, subject list (count · combined term · persisted sort) |

**Owner-directed batches outside the phase sequence:** v1.7.1 (three-level
recovery model, retroactive counts-as-attendance, dock-aware layout, SemVer
adopted) · v1.7.2 (two-mode cells, custom dock thumb) · **v1.8.0** (Modal
focus-trap root fix; configurable cell-coloring rules with priority
reordering; automatic assessment short codes; synced free-form NOTES on
date columns + score cells — the first snapshot-version bump, DB v8 /
snapshot v6; notes data model already carries student/subject levels and is
Search-Notes-ready).

One phase per fully-verified release cycle: eslint → engine (59) →
formatting (48) → grid-selection (48) → class-stats (25) → scenario lab
(71) → recycle (14) → workflows (55) → window-state (34) → `--no-pack` →
push → blob-SHA check → `desktop:release`.

## Appendix C — Design-review Top 20 (2026-07-10, compact)

Full analysis lives in the design review. Ranked: 1 selection model ·
2 Excel clipboard bridge · 3 fill down · 4 print pack · 5 missing-score
workflow · 6 class stats footer · 7 semester rollover · 8 end-of-semester
pack (transmutation/registrar/archive) · 9 sync staleness sentinel ·
10 menu bar + F1 · 11 rank & filter views · 12 contextual grid status
strip · 13 visual maturity batch · 14 reopen last subject + Jump List ·
15 sync change digest · 16 drop-lowest/best-N · 17 student focus panel ·
18 excused status · 19 column QoL · 20 conflict review completion.

**Deliberately not building:** arbitrary formulas, cell formatting, full
grid virtualization (until measured), dark mode (for now), accounts/cloud
services, ribbon UI, MDI, realtime co-editing, gamification.
