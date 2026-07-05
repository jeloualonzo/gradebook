'use client';
import { useState, useRef, useEffect } from 'react';
import { useAutosave } from '@/lib/hooks/useAutosave';
import { formatNumber } from '@/lib/gradeCalculator';

export default function ScoreCell({ columnId, studentId, initialValue, maxScore, onUpdate, history }) {
  const [value, setValue] = useState(initialValue !== undefined && initialValue !== null ? formatNumber(initialValue) : '');
  const save = useAutosave();
  const inputRef = useRef(null);
  // Value captured when the cell gains focus — used to record ONE undo entry
  // per edit session (like committing a cell in Excel), not one per keystroke.
  const focusValueRef = useRef(undefined);

  // Sync from external changes (undo/redo, refresh) while not being edited.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setValue(initialValue !== undefined && initialValue !== null ? formatNumber(initialValue) : '');
  }, [initialValue]);

  const isEmpty = value === '' || value === null || value === undefined;
  const numVal = parseFloat(value);
  const isOver = !isEmpty && numVal > parseFloat(maxScore);

  const putScore = (v) =>
    fetch(`/api/scores/${columnId}/${studentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: v === null || v === '' ? null : parseFloat(v) }),
    });

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    onUpdate(columnId, studentId, v === '' ? null : v);
    save(`${columnId}-${studentId}`, async () => {
      await putScore(v);
    });
  };

  const handleFocus = () => {
    focusValueRef.current = value;
  };

  const handleBlur = () => {
    const before = focusValueRef.current;
    focusValueRef.current = undefined;
    if (before === undefined || before === value || !history) return;
    const oldVal = before === '' ? null : before;
    const newVal = value === '' ? null : value;
    if (String(oldVal) === String(newVal)) return;
    const apply = async (v) => {
      await putScore(v);
      onUpdate(columnId, studentId, v);
    };
    history.push({
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
