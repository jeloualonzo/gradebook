'use client';
import { useState, useRef } from 'react';
import { useAutosave } from '@/lib/hooks/useAutosave';
import { formatNumber } from '@/lib/gradeCalculator';

export default function ScoreCell({ columnId, studentId, initialValue, maxScore, onUpdate }) {
  const [value, setValue] = useState(initialValue !== undefined && initialValue !== null ? formatNumber(initialValue) : '');
  const save = useAutosave();
  const inputRef = useRef(null);

  const isEmpty = value === '' || value === null || value === undefined;
  const numVal = parseFloat(value);
  const isOver = !isEmpty && numVal > parseFloat(maxScore);

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    onUpdate(columnId, studentId, v === '' ? null : v);
    save(`${columnId}-${studentId}`, async () => {
      await fetch(`/api/scores/${columnId}/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: v === '' ? null : parseFloat(v) }),
      });
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
      onKeyDown={handleKeyDown}
      data-col={columnId}
      className={`score-cell w-full text-center text-xs py-1.5 border-0 focus:bg-blue-50 transition-colors ${
        isEmpty ? 'missing-score' : isOver ? 'bg-red-50 text-red-700' : 'bg-white'
      }`}
      style={{ minWidth: '25px' }}
    />
  );
}
