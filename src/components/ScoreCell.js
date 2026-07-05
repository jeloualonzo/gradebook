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
function ScoreCell({ columnId, studentId, initialValue, maxScore, onUpdate, onHistoryPush, onSaveError }) {
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
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v); // local only — the rest of the grid does not re-render
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

  const handleFocus = () => {
    focusValueRef.current = value;
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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const cells = document.querySelectorAll(`[data-col="${columnId}"]`);
      const current = Array.from(cells).indexOf(e.target);
      if (current < cells.length - 1) cells[current + 1].focus();
    }
    if (e.key === 'Tab') {
    }
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
