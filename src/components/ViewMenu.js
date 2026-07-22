'use client';
import { useState, useEffect, useRef } from 'react';

/**
 * The View popover (v1.7.0) — every LENS control in one calm place, Office
 * style: filter + threshold, sort, and the display toggles (stats footer,
 * missing highlight). The button carries a blue dot whenever anything is
 * non-default, so state is never hidden. Chosen over a left sidebar on
 * purpose: a grid app's horizontal space belongs to the grid.
 */
export default function ViewMenu({
  viewMode, viewThreshold, viewSort, applyView,
  showStats, toggleStats,
  showMissingHighlight, toggleMissingHighlight,
  showCodes, toggleCodes,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nonDefault = viewMode !== 'all' || viewSort !== 'az' || showStats || showMissingHighlight === false || showCodes === false;
  const seg = (active) =>
    `px-2 py-1 text-xs rounded border ${active ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;
  const row = 'flex items-center justify-between gap-3 py-1.5';
  const label = 'text-xs text-gray-600';

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`relative px-3 py-1.5 text-xs font-medium border rounded-lg flex items-center gap-1.5 ${open ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
        title="Filters, sorting, and display options"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        View
        {nonDefault && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-40 p-3 gb-modal-in">
          <p className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase mb-1">Show</p>
          <div className={row}>
            <span className={label}>Students</span>
            <select
              value={viewMode}
              onChange={e => applyView(e.target.value, viewThreshold, viewSort)}
              className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All students</option>
              <option value="missing">With missing work</option>
              <option value="below">Below threshold</option>
            </select>
          </div>
          {viewMode === 'below' && (
            <div className={row}>
              <span className={label}>Threshold <span className="text-gray-400">(view only)</span></span>
              <input
                type="number"
                value={viewThreshold}
                min="0"
                max="100"
                onChange={e => applyView('below', parseFloat(e.target.value) || 0, viewSort)}
                className="w-16 text-xs border border-gray-200 rounded px-1.5 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          <div className={row}>
            <span className={label}>Sort</span>
            <span className="flex gap-1">
              <button className={seg(viewSort === 'az')} onClick={() => applyView(viewMode, viewThreshold, 'az')}>A–Z</button>
              <button className={seg(viewSort === 'asc')} onClick={() => applyView(viewMode, viewThreshold, 'asc')} title="Lowest grades first — intervention order">Grade ↑</button>
              <button className={seg(viewSort === 'desc')} onClick={() => applyView(viewMode, viewThreshold, 'desc')}>Grade ↓</button>
            </span>
          </div>
          <div className="border-t border-gray-100 my-2" />
          <p className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase mb-1">Display</p>
          <label className={`${row} cursor-pointer`}>
            <span className={label}>Class statistics footer</span>
            <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={!!showStats} onChange={toggleStats} />
          </label>
          <label className={`${row} cursor-pointer`} title="The tint on blank cells and the missing-work chips — the same switch as the Missing rule in Settings → Cell Coloring">
            <span className={label}>Missing-score highlight</span>
            <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={showMissingHighlight !== false} onChange={toggleMissingHighlight} />
          </label>
          <label className={`${row} cursor-pointer`} title="Q1 Q2 A1 … — automatic short codes under the dates, renumbered with the current column order">
            <span className={label}>Assessment short codes</span>
            <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={showCodes !== false} onChange={toggleCodes} />
          </label>
          <a
            href="/settings?tab=formatting"
            className="block text-xs text-blue-600 hover:underline pt-2 mt-1 border-t border-gray-100"
          >
            Cell coloring rules…
          </a>
        </div>
      )}
    </div>
  );
}
