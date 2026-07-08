'use client';
import { useState, useRef, useEffect, memo } from 'react';
import { useAutosave } from '@/lib/hooks/useAutosave';
import { formatNumber } from '@/lib/gradeCalculator';

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
  // Value captured when the cell gains focus — used to record ONE undo entry
  // per edit session (like committing a cell in Excel), not one per keystroke.
  const focusValueRef = useRef(undefined);
  // Latest rendered value + last server-confirmed value (rollback target).
  const valueRef = useRef(value);
  const lastSavedRef = useRef(value);
  useEffect(() => { valueRef.current = value; });

  // Sync from external changes (undo/redo, import, refresh) while not editing.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    const v = initialValue !== undefined && initialValue !== null ? formatNumber(initialValue) : '';
    if (valueRef.current !== v) {
      lastSavedRef.current = v; // external change reflects server truth
      setValue(v);
    }
  }, [initialValue]);

  const isEmpty = value === '' || value === null || value === undefined;
  const numVal = parseFloat(value);
  const isOver = !isEmpty && numVal > parseFloat(maxScore);

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

  const handleFocus = (e) => {
    focusValueRef.current = value;
    // Spreadsheet-style: selecting a cell selects its content (type to replace).
    e.target.select();
  };

  const handleBlur = () => {
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
    el.focus();
    el.select?.();
    return true;
  };
  const columnCells = () =>
    Array.from(document.querySelectorAll(`input[data-cell="score"][data-col="${columnId}"]`));
  const rowCells = (target) =>
    Array.from(target.closest('tr')?.querySelectorAll('input[data-cell="score"]') || []);

  const handleKeyDown = (e) => {
    // Never shadow Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z or browser shortcuts.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;

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
        // exit edit mode. No history entry is recorded (blur sees no change).
        e.preventDefault();
        const before = focusValueRef.current;
        if (before !== undefined && before !== value) {
          setValue(before);
          onUpdate(columnId, studentId, before === '' ? null : before);
          scheduleSave(before);
        }
        requestAnimationFrame(() => t.blur());
        break;
      }
      case 'Delete': {
        // Clear the cell's value (never the column) and keep the selection.
        e.preventDefault();
        setValue('');
        onUpdate(columnId, studentId, null);
        scheduleSave('');
        break;
      }
      case 'Home':
      case 'End': {
        e.preventDefault();
        const cells = rowCells(t);
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
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      data-cell="score"
      data-col={columnId}
      className={`score-cell w-full text-center text-xs py-1.5 border-0 focus:bg-blue-50 transition-colors ${
        isEmpty ? 'missing-score' : isOver ? 'bg-red-50 text-red-700' : 'bg-white'
      }`}
    />
  );
}

// Memoized: a commit in one cell re-renders only the affected cells, keeping
// the grid smooth with dozens of students × hundreds of columns.
export default memo(ScoreCell);
