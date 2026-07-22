'use client';
import { useState, useRef, useEffect, memo } from 'react';
import { useAutosave } from '@/lib/hooks/useAutosave';
import { formatNumber } from '@/lib/gradeCalculator';
import { resolveHighlight } from '@/lib/highlights';
import { useHighlights } from '@/lib/highlightsClient';

/**
 * One editable score cell.
 *
 * Performance model (spreadsheet-style):
 * - While TYPING, only this cell's local state updates — the shared scores
 *   map is untouched, so no other cell in the grid re-renders per keystroke.
 * - Saving happens silently in the background (debounced). If it fails, the
 *   cell rolls back to the last saved value and an error toast is shown.
 * - On COMMIT (blur / Enter), the value is propagated to the shared scores
 *   map once, updating the computed period/final grades, and a single
 *   undo/redo history entry is recorded for the whole edit session.
 */
function ScoreCell({ columnId, studentId, initialValue, maxScore, onUpdate, onAttendanceApplied, onHistoryPush, onSaveError }) {
  const [value, setValue] = useState(initialValue !== undefined && initialValue !== null ? formatNumber(initialValue) : '');
  const save = useAutosave();
  const inputRef = useRef(null);
  // Two-mode cell (v1.7.2 — accidental-overwrite protection). READY mode:
  // the input is readOnly — focused, navigable, nothing selected, no caret;
  // stray keystrokes cannot destroy a grade. EDIT mode is INTENTIONAL:
  // double-click, F2, Delete/Backspace, or typing into an EMPTY cell (the
  // fast-entry cadence — type 8, Enter, type 7 — is unchanged, because
  // empty cells have nothing to lose). Excel/Sheets replace-on-type is
  // exactly the behavior that loses data; this keeps their speed without it.
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  useEffect(() => { editingRef.current = editing; });
  // Value captured when the cell gains focus — used to record ONE undo entry
  // per edit session (like committing a cell in Excel), not one per keystroke.
  const focusValueRef = useRef(undefined);
  // Latest rendered value + last server-confirmed value (rollback target).
  const valueRef = useRef(value);
  const lastSavedRef = useRef(value);
  useEffect(() => { valueRef.current = value; });

  // Sync from external changes (undo/redo, import, refresh) while not editing.
  // A focused-but-READY cell must still reflect them (only a live edit wins).
  useEffect(() => {
    if (document.activeElement === inputRef.current && editingRef.current) return;
    const v = initialValue !== undefined && initialValue !== null ? formatNumber(initialValue) : '';
    if (valueRef.current !== v) {
      lastSavedRef.current = v; // external change reflects server truth
      setValue(v);
    }
  }, [initialValue]);

  const isEmpty = value === '' || value === null || value === undefined;

  // Configurable highlighting (v1.8.0): the first enabled rule that matches
  // (user-ordered priority) colors the cell — missing, zero, over-max,
  // below-passing … all one system (Settings → Cell Coloring). Read through
  // context so the memoized cell needs no new prop.
  const hlConfig = useHighlights();
  const hl = resolveHighlight('score', { value, max: maxScore }, hlConfig);

  const putScore = async (v) => {
    const res = await fetch(`/api/scores/${columnId}/${studentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: v === null || v === '' ? null : parseFloat(v) }),
    });
    if (!res.ok) throw new Error('Save failed');
    // "Counts as attendance" columns: the server may have just marked this
    // student Present — mirror it in the grid immediately.
    const json = await res.json().catch(() => null);
    if (json?.attendance?.applied) onAttendanceApplied?.(json.attendance);
  };

  // Debounced background save with rollback on failure.
  const scheduleSave = (v) => {
    save(
      `${columnId}-${studentId}`,
      async () => {
        await putScore(v);
        lastSavedRef.current = v;
      },
      () => {
        // Save failed — roll back to the last value the server confirmed.
        const prev = lastSavedRef.current ?? '';
        setValue(prev);
        onUpdate(columnId, studentId, prev === '' ? null : prev);
        onSaveError?.('Could not save the score — value restored.');
      }
    );
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v); // local only — the rest of the grid does not re-render
    scheduleSave(v);
  };

  const handleFocus = () => {
    focusValueRef.current = value;
    // READY mode on arrival: nothing selected, nothing at risk.
  };

  /** Enter EDIT mode deliberately. Explicit entry selects the content (the
      user CHOSE to replace); typing into an empty cell starts from the
      typed character. */
  const beginEdit = (initialChar) => {
    setEditing(true);
    if (initialChar !== undefined) {
      setValue(initialChar);
      scheduleSave(initialChar);
    }
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      if (initialChar === undefined) el.select();
    });
  };

  /** Filled + READY + stray key: flash "locked" instead of destroying data. */
  const flashLocked = () => {
    const el = inputRef.current;
    if (!el) return;
    el.classList.add('gb-cell-locked');
    setTimeout(() => el.classList.remove('gb-cell-locked'), 300);
  };

  const handleBlur = () => {
    setEditing(false);
    const before = focusValueRef.current;
    focusValueRef.current = undefined;
    if (before === undefined || before === value) return;
    // Commit once: update the shared scores map (recomputes period grades).
    onUpdate(columnId, studentId, value === '' ? null : value);
    const oldVal = before === '' ? null : before;
    const newVal = value === '' ? null : value;
    if (String(oldVal) === String(newVal) || !onHistoryPush) return;
    const apply = async (v) => {
      await putScore(v);
      lastSavedRef.current = v ?? '';
      onUpdate(columnId, studentId, v);
    };
    onHistoryPush({
      label: 'edit score',
      undo: () => apply(oldVal),
      redo: () => apply(newVal),
    });
  };

  // ---- Spreadsheet-style keyboard navigation --------------------------------
  // DOM-query based (like Excel's grid): works regardless of memoization and
  // stays scoped to the gradebook because handlers live on the cells.
  const focusCell = (el) => {
    if (!el) return false;
    el.focus(); // arriving = READY mode; nothing gets selected
    return true;
  };
  // Queries stay inside the current GRID SCOPE ([data-grid-scope]) so the
  // main grid and a Focus Assessment modal — which render the same column's
  // cells simultaneously — each navigate among their OWN cells only.
  const scopeOf = (el) => el.closest('[data-grid-scope]') || document;
  const columnCells = (target = inputRef.current) =>
    Array.from(scopeOf(target).querySelectorAll(`input[data-cell="score"][data-col="${columnId}"]`));
  const rowCells = (target) =>
    Array.from(target.closest('tr')?.querySelectorAll('input[data-cell="score"]') || []);

  const handleKeyDown = (e) => {
    // Ctrl+Home / Ctrl+End: the very first / last cell of the whole grid
    // (Excel-style corner jumps). Handled before the modifier guard below.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      const all = Array.from(scopeOf(e.target).querySelectorAll('input[data-cell="score"]'));
      focusCell(e.key === 'Home' ? all[0] : all[all.length - 1]);
      return;
    }
    // Never shadow Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z or browser shortcuts.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;

    // F2 on a SCORE cell edits the cell (true Excel). Assessment renaming
    // keeps F2 on the header cells (date/max), where it always lived.
    if (e.key === 'F2' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!editing) beginEdit();
      return;
    }

    // READY mode: a printable score character starts an edit only where
    // nothing can be lost. Filled cells flash "locked" — edit is F2 /
    // double-click / Delete, always intentional.
    if (!editing && /^[0-9.]$/.test(e.key)) {
      e.preventDefault();
      if (isEmpty) beginEdit(e.key);
      else flashLocked();
      return;
    }

    // While EDITING, ←/→ move the caret (don't navigate); ↑/↓/Enter/Tab
    // commit-and-navigate as always; Escape reverts below.
    if (editing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault(); // also stops the number input from decrementing
        const cells = columnCells();
        focusCell(cells[cells.indexOf(t) + 1]);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault(); // also stops the number input from incrementing
        const cells = columnCells();
        const i = cells.indexOf(t);
        if (i > 0) focusCell(cells[i - 1]);
        // From the top student row, move up into the column's max-score cell.
        else focusCell(document.querySelector(`input[data-max-for="${columnId}"]`));
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const cells = rowCells(t);
        focusCell(cells[cells.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1)]);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const cells = columnCells();
        const next = cells[cells.indexOf(t) + 1];
        if (next) focusCell(next); // commit happens via blur
        else t.blur(); // last row: commit and stay (Excel-like)
        break;
      }
      case 'Escape': {
        // Cancel the edit: restore the value from when the cell was entered —
        // in the UI, the shared scores map, AND the background save — then
        // return to READY without losing the selection (Excel stays put).
        e.preventDefault();
        const before = focusValueRef.current;
        if (before !== undefined && before !== value) {
          setValue(before);
          onUpdate(columnId, studentId, before === '' ? null : before);
          scheduleSave(before);
        }
        setEditing(false);
        break;
      }
      case 'Delete':
      case 'Backspace': {
        // Clear the cell's value (never the column) and keep the selection.
        // Explicitly destructive — and one Ctrl+Z away, like everything else.
        if (editing) break; // mid-edit, Backspace edits text natively
        e.preventDefault();
        setValue('');
        onUpdate(columnId, studentId, null);
        scheduleSave('');
        break;
      }
      case 'Home':
      case 'End': {
        // First / last STUDENT in this column — the fast vertical jump long
        // rosters need. (Row jumps: ←/→, Tab, and PageUp/PageDown scroll;
        // grid corners: Ctrl+Home / Ctrl+End above.)
        e.preventDefault();
        const cells = columnCells();
        focusCell(e.key === 'Home' ? cells[0] : cells[cells.length - 1]);
        break;
      }
      case 'PageDown':
      case 'PageUp': {
        // Scroll horizontally across grading periods in large gradebooks.
        e.preventDefault();
        const scroller = t.closest('.overflow-x-auto');
        scroller?.scrollBy({
          left: (e.key === 'PageDown' ? 1 : -1) * scroller.clientWidth * 0.8,
          behavior: 'smooth',
        });
        break;
      }
      default:
        break;
    }
    // Tab / Shift+Tab intentionally keep native behavior: save (via blur) and
    // move right / left through the grid's inputs.
  };

  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      max={maxScore}
      step="0.01"
      value={value}
      readOnly={!editing}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => { if (!editing) beginEdit(); }}
      data-cell="score"
      data-col={columnId}
      style={hl ? { '--hl-bg': hl.bg, '--hl-fg': hl.fg } : undefined}
      className={`score-cell w-full text-center text-xs py-1.5 border-0 focus:bg-blue-50 transition-colors ${hl ? 'gb-hl' : 'bg-white'}`}
    />
  );
}

// Memoized: a commit in one cell re-renders only the affected cells, keeping
// the grid smooth with dozens of students × hundreds of columns.
export default memo(ScoreCell);
