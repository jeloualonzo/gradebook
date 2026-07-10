import { rowsEqual } from './engine.mjs';

/**
 * Review semantics — which merge decisions deserve a HUMAN's attention.
 *
 * Pure module (no I/O), consulted by the conflict LOGGER only. The merge
 * engine (engine.mjs) knows nothing about review and never imports this
 * file: merging still propagates a row whenever anything differs —
 * updated_at included — so both databases keep converging byte-identically.
 * This module only decides what the review UI surfaces.
 *
 * The rule (the owner's, verbatim): the review page answers ONE question —
 * "did the two laptops produce different gradebook data?" A conflict entry
 * exists to demand a decision; if a teacher comparing both versions could
 * not tell them apart on screen, there is no decision to make and no entry
 * to write. Lineage and bookkeeping never qualify.
 */

// Never part of what the teacher sees: row identity, creation/edit stamps,
// device attribution. Foreign keys are NOT listed here on purpose — they
// encode where a row lives (a column moved to two different assessments is
// a real, visible divergence).
const NEVER_SEMANTIC = new Set([
  'id',
  'created_at',
  'updated_at',
  'owner_device_id',
  'deleted_by_device_id',
]);

// WHETHER a row is deleted/purged is data; WHEN it happened is bookkeeping.
// Two laptops independently deleting the same row agree on the outcome —
// nothing to review. Deleted-vs-active always logs.
const PRESENCE_ONLY = new Set(['deleted_at', 'purged_at']);

// Per-table extras. students.sort_order exists (import order) but every
// roster in the app renders alphabetically (last, first, middle COLLATE
// NOCASE) — the value is invisible to the user, so a difference in it is
// not reviewable. Group members DO render by sort_order (drag reorder), so
// theirs stays semantic; same for assessments and date columns.
const EXTRA_NON_SEMANTIC = {
  students: new Set(['sort_order']),
};

/** The columns of `table` whose values a user could actually see. */
export function semanticColumns(table) {
  const extra = EXTRA_NON_SEMANTIC[table.name];
  return table.columns.filter(
    c => !NEVER_SEMANTIC.has(c) && !PRESENCE_ONLY.has(c) && !(extra && extra.has(c))
  );
}

/**
 * True when two versions of a row are the same GRADEBOOK DATA — i.e. a
 * teacher comparing both screens could not tell them apart, whatever the
 * timestamps, ids, or attribution say. Comparison is deliberately strict
 * (engine `rowsEqual` semantics): when in doubt, a pair counts as
 * different and still logs — suppression must never eat a real conflict.
 */
export function semanticallyEqual(table, a, b) {
  if (!rowsEqual(a || {}, b || {}, semanticColumns(table))) return false;
  for (const c of PRESENCE_ONLY) {
    if (!table.columns.includes(c)) continue;
    if (Boolean(a?.[c]) !== Boolean(b?.[c])) return false;
  }
  return true;
}
