'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { searchText } from '@/lib/names';
import { useHotkey } from '@/lib/hooks/useHotkey';

/**
 * Excel-style Find (Ctrl+F) for the gradebook.
 *
 * - Matches any part of a student's name (same matcher as the search boxes)
 * - Scrolls the grid to the match and keeps it highlighted while open
 * - Enter → next match · Shift+Enter → previous · Esc → close
 * - Ctrl+F while open refocuses and selects the query for a new search
 *
 * The highlight is applied imperatively (a row class + scrollIntoView), so
 * typing in the box never re-renders the grid itself.
 */
export default function FindStudentBar({ students, gridRef }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return students.filter(s => searchText(s).includes(needle));
  }, [students, q]);

  const safeIdx = matches.length ? Math.min(idx, matches.length - 1) : 0;
  const current = matches.length ? matches[safeIdx] : null;

  useHotkey('ctrl+f', (e) => {
    e.preventDefault(); // ours, not the (nonexistent) built-in find
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, { allowInInputs: true });

  // Highlight + scroll to the current match; clear when the box closes.
  useEffect(() => {
    const root = gridRef.current;
    if (!root) return undefined;
    for (const el of root.querySelectorAll('tr.find-active-row')) el.classList.remove('find-active-row');
    if (!open || !current) return undefined;
    const row = root.querySelector(`tr[data-student-row="${current.id}"]`);
    if (row) {
      row.classList.add('find-active-row');
      row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
    return () => {
      for (const el of root.querySelectorAll('tr.find-active-row')) el.classList.remove('find-active-row');
    };
  }, [open, current, gridRef]);

  if (!open) return null;

  const step = (delta) => {
    if (!matches.length) return;
    setIdx((safeIdx + delta + matches.length) % matches.length);
  };
  const close = () => { setOpen(false); setQ(''); setIdx(0); };

  const navBtn = 'p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30';

  return (
    <div className="fixed top-16 right-6 z-40 flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg shadow-lg pl-3 pr-2 py-1.5">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={inputRef}
        autoFocus
        value={q}
        onChange={e => { setQ(e.target.value); setIdx(0); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
        placeholder="Find student…"
        className="w-44 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
      />
      <span className={`text-xs tabular-nums whitespace-nowrap ${matches.length || !q.trim() ? 'text-gray-400' : 'text-red-500'}`}>
        {q.trim() ? (matches.length ? `${safeIdx + 1} of ${matches.length}` : 'No matches') : ''}
      </span>
      <button onClick={() => step(-1)} disabled={!matches.length} className={navBtn} title="Previous match (Shift+Enter)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
      </button>
      <button onClick={() => step(1)} disabled={!matches.length} className={navBtn} title="Next match (Enter)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      <button onClick={close} className={navBtn} title="Close (Esc)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}
