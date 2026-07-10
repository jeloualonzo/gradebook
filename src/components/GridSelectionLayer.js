'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createSelectionModel, computeSelectionStats } from '@/lib/gridSelection';
import { formatNumber } from '@/lib/gradeCalculator';

/**
 * The selection engine's thin imperative shell (ROADMAP Phase 2, batch 2a).
 *
 * Owns the pure selection model and translates between it and the page:
 * pointer + keyboard + focus listeners on the grid container feed the model;
 * the model's notifications position ONE absolutely-positioned overlay and
 * update the stats pill. ScoreCell is untouched and receives no new props —
 * a selection change never re-renders a cell (the grid's memoization
 * contract, see AGENTS.md §11).
 *
 * The overlay renders only for MULTI-cell selections: a single selected cell
 * is already represented by the input's own focus ring, and doubling that
 * border would be noise. It sits above the cells and below the sticky
 * #/name columns (z-index), so a selection slides UNDER the frozen pane —
 * exactly how Excel paints it.
 */
export default function GridSelectionLayer({
  gridRef,        // the horizontal scroll container
  wrapRef,        // position:relative wrapper around the <table> (overlay parent)
  geometry,       // { rows, cols, rowIndex, colIndex } — memoized upstream
  getScores,      // () => live scores map
  onClearRange,   // (cells: [{column_id, student_id}], label) => void
  onOpenMenu,     // (event, items) => void — the grid's shared context menu
}) {
  // One model instance for the component's lifetime (useState initializer —
  // the lint-sanctioned way to hold a stable non-render value).
  const [model] = useState(() => createSelectionModel());

  const overlayRef = useRef(null);
  const dragging = useRef(false);
  const suppressFocusSync = useRef(false);
  const statsFrame = useRef(null);
  const [stats, setStats] = useState(null); // multi-cell only; null hides the pill

  // ---- geometry → model (collapses selection on structural change) ----------
  useEffect(() => { model.setGeometry(geometry); }, [geometry, model]);

  // ---- helpers ---------------------------------------------------------------
  const cellCoords = useCallback((el) => {
    const input = el?.closest?.('input[data-cell="score"]');
    if (!input) return null;
    const tr = input.closest('tr[data-student-row]');
    if (!tr) return null;
    const c = geometry.colIndex.get(String(input.getAttribute('data-col')));
    const r = geometry.rowIndex.get(String(tr.getAttribute('data-student-row')));
    return c === undefined || r === undefined ? null : { r, c };
  }, [geometry]);

  const rowCoordFromNumberCell = useCallback((el) => {
    const td = el?.closest?.('td.sticky-col');
    if (!td) return null;
    const tr = td.closest('tr[data-student-row]');
    if (!tr) return null;
    const r = geometry.rowIndex.get(String(tr.getAttribute('data-student-row')));
    return r === undefined ? null : r;
  }, [geometry]);

  const tdFor = useCallback((r, c) => {
    const rowId = geometry.rows[r];
    const col = geometry.cols[c];
    if (rowId === undefined || !col) return null;
    return gridRef.current
      ?.querySelector(`tr[data-student-row="${rowId}"] input[data-col="${col.columnId}"]`)
      ?.closest('td') || null;
  }, [geometry, gridRef]);

  // ---- rendering: overlay + stats, driven by model notifications -------------
  const reposition = useCallback(() => {
    const overlay = overlayRef.current;
    const wrap = wrapRef.current;
    if (!overlay || !wrap) return;
    const rect = model.rect();
    if (!rect || !model.isMulti()) {
      overlay.style.display = 'none';
      return;
    }
    const first = tdFor(rect.r1, rect.c1);
    const last = tdFor(rect.r2, rect.c2);
    if (!first || !last) { overlay.style.display = 'none'; return; }
    const w = wrap.getBoundingClientRect();
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${a.left - w.left}px`;
    overlay.style.top = `${a.top - w.top}px`;
    overlay.style.width = `${b.right - a.left}px`;
    overlay.style.height = `${b.bottom - a.top}px`;
  }, [model, tdFor, wrapRef]);

  const refreshStats = useCallback(() => {
    if (statsFrame.current) return;
    statsFrame.current = requestAnimationFrame(() => {
      statsFrame.current = null;
      if (!model.isMulti()) { setStats(null); return; }
      setStats(computeSelectionStats(model.geometry(), model.rect(), getScores?.() || {}));
    });
  }, [model, getScores]);

  useEffect(() => {
    const unsubscribe = model.subscribe(() => { reposition(); refreshStats(); });
    // Layout shifts (column add/resize, zoom) move cells under the overlay —
    // the table resize observer pattern the sticky scrollbar already uses.
    const table = gridRef.current?.querySelector('table');
    const ro = table ? new ResizeObserver(reposition) : null;
    if (ro && table) ro.observe(table);
    return () => { unsubscribe(); ro?.disconnect(); };
  }, [model, reposition, refreshStats, gridRef]);

  // ---- range clear (the one range operation in batch 2a) ---------------------
  const clearSelection = useCallback(() => {
    const scores = getScores?.() || {};
    const cells = [];
    model.forEachCell(({ rowId, col }) => {
      const v = scores?.[col.columnId]?.[rowId];
      if (v !== undefined && v !== null && v !== '') {
        cells.push({ column_id: col.columnId, student_id: rowId });
      }
    });
    if (cells.length === 0) return;
    onClearRange?.(cells, `clear ${cells.length} score${cells.length === 1 ? '' : 's'}`);
  }, [model, getScores, onClearRange]);

  // ---- input wiring on the grid container ------------------------------------
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;

    // Selection follows the ACTIVE cell for every native movement (click,
    // arrows, Tab, Enter, find) via focusin — one hook instead of five.
    const onFocusIn = (e) => {
      if (suppressFocusSync.current) return;
      const at = cellCoords(e.target);
      if (at) model.set(at.r, at.c);
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const at = cellCoords(e.target);
      if (at) {
        if (e.shiftKey) {
          // Extend from the anchor; keep DOM focus (and the edit session)
          // where it is — exactly Excel's Shift+Click.
          e.preventDefault();
          model.extendTo(at.r, at.c);
          return;
        }
        dragging.current = true;
        grid.classList.add('gb-selecting');
        try { grid.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
        return; // focusin sets the anchor
      }
      // The # row-number cell is dead space today — make it the row handle.
      const row = rowCoordFromNumberCell(e.target);
      if (row !== null) {
        e.preventDefault();
        suppressFocusSync.current = true;
        if (e.shiftKey) model.extendRowTo(row);
        else model.selectRow(row);
        suppressFocusSync.current = false;
      }
    };

    const onPointerMove = (e) => {
      if (!dragging.current) return;
      e.preventDefault(); // no native text-drag selection mid-drag
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const at = cellCoords(el);
      if (at) model.extendTo(at.r, at.c);
    };

    const endDrag = (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      grid.classList.remove('gb-selecting');
      try { grid.releasePointerCapture(e.pointerId); } catch { /* not held */ }
    };

    // Capture phase: selection chords run BEFORE the cell's own handler;
    // plain keys pass through untouched (the cell handler owns them, and
    // focusin keeps the model in step).
    const onKeyDown = (e) => {
      const onScoreCell = !!e.target?.closest?.('input[data-cell="score"]');
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

      if (onScoreCell && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && arrows[e.key]) {
        e.preventDefault();
        e.stopPropagation();
        const [dr, dc] = arrows[e.key];
        model.moveFocus(dr, dc, { extend: true });
        return;
      }
      if (onScoreCell && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        model.selectAll();
        return;
      }
      if (onScoreCell && e.key === ' ' && !e.altKey) {
        // Excel's own bindings: Ctrl+Space = column, Shift+Space = row.
        const at = cellCoords(e.target);
        if (at && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault(); e.stopPropagation(); model.selectColumn(at.c); return;
        }
        if (at && e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault(); e.stopPropagation(); model.selectRow(at.r); return;
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && model.isMulti() && onScoreCell) {
        // Range clear — the cell's own single-cell Delete never sees this.
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
        return;
      }
      if (e.key === 'Escape' && model.isMulti()) {
        // Do NOT stop propagation: the cell's own Escape (cancel edit)
        // still runs; the range collapses alongside it.
        model.collapse();
      }
    };

    const onContextMenu = (e) => {
      if (!onOpenMenu) return;
      const at = cellCoords(e.target);
      if (!at) return;
      if (!model.contains(at.r, at.c)) model.set(at.r, at.c);
      const multi = model.isMulti();
      const items = [];
      if (multi) items.push({ label: `Clear ${model.size()} cells`, danger: true, onClick: () => clearSelection() });
      items.push({ label: 'Select column', onClick: () => model.selectColumn(at.c) });
      items.push({ label: 'Select row', onClick: () => model.selectRow(at.r) });
      onOpenMenu(e, items);
    };

    grid.addEventListener('focusin', onFocusIn);
    grid.addEventListener('pointerdown', onPointerDown);
    grid.addEventListener('pointermove', onPointerMove);
    grid.addEventListener('pointerup', endDrag);
    grid.addEventListener('pointercancel', endDrag);
    grid.addEventListener('keydown', onKeyDown, true);
    grid.addEventListener('contextmenu', onContextMenu);
    return () => {
      grid.removeEventListener('focusin', onFocusIn);
      grid.removeEventListener('pointerdown', onPointerDown);
      grid.removeEventListener('pointermove', onPointerMove);
      grid.removeEventListener('pointerup', endDrag);
      grid.removeEventListener('pointercancel', endDrag);
      grid.removeEventListener('keydown', onKeyDown, true);
      grid.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gridRef, model, cellCoords, rowCoordFromNumberCell, onOpenMenu, clearSelection]);

  return (
    <>
      <div ref={overlayRef} className="gb-sel-overlay" aria-hidden="true" />
      {stats && stats.cells > 1 && (
        <div className="fixed bottom-3 left-4 z-30 flex items-center gap-3 bg-white/95 border border-gray-200 rounded shadow-md px-3 py-1.5 text-[11px] text-gray-600 gb-toast-in">
          <span className="font-semibold text-gray-800">{stats.cells} cells</span>
          {stats.values > 0 && (
            <>
              <span>Avg {formatNumber(stats.avg)}</span>
              <span>High {formatNumber(stats.high)}</span>
              <span>Low {formatNumber(stats.low)}</span>
            </>
          )}
          {stats.missing > 0 && <span className="text-amber-600">{stats.missing} missing</span>}
        </div>
      )}
    </>
  );
}
