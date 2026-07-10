'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createSelectionModel, computeSelectionStats } from '@/lib/gridSelection';
import { serializeRange, parseClipboardText, resolvePaste } from '@/lib/tsv';
import { formatNumber } from '@/lib/gradeCalculator';
import ConfirmDialog from './ConfirmDialog';

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
  onApplyRange,   // (entries: [{column_id, student_id, value|null}], label) => void
  onOpenMenu,     // (event, items) => void — the grid's shared context menu
}) {
  // One model instance for the component's lifetime (useState initializer —
  // the lint-sanctioned way to hold a stable non-render value).
  const [model] = useState(() => createSelectionModel());

  const overlayRef = useRef(null);
  const antsRef = useRef(null);   // marching-ants marquee (clipboard source)
  const clipRef = useRef(null);   // { rect, cut } — what Ctrl+C/X captured
  const dragging = useRef(false);
  const suppressFocusSync = useRef(false);
  const statsFrame = useRef(null);
  const [stats, setStats] = useState(null);     // multi-cell only; null hides the pill
  const [pending, setPending] = useState(null); // paste preview: { entries, label, message }

  // ---- geometry → model (collapses selection on structural change) ----------
  // A structural change also drops the clipboard marquee: its rectangle is
  // expressed in the OLD coordinates and must never be remapped (Excel drops
  // its marquee just as readily).
  useEffect(() => {
    model.setGeometry(geometry);
    clipRef.current = null;
    if (antsRef.current) antsRef.current.style.display = 'none';
  }, [geometry, model]);

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

  // Position the marching-ants marquee over the copied/cut rectangle.
  const repositionAnts = useCallback(() => {
    const ants = antsRef.current;
    const wrap = wrapRef.current;
    if (!ants || !wrap) return;
    const clip = clipRef.current;
    if (!clip) { ants.style.display = 'none'; return; }
    const first = tdFor(clip.rect.r1, clip.rect.c1);
    const last = tdFor(clip.rect.r2, clip.rect.c2);
    if (!first || !last) { ants.style.display = 'none'; return; }
    const w = wrap.getBoundingClientRect();
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    const width = b.right - a.left;
    const height = b.bottom - a.top;
    ants.style.display = 'block';
    ants.style.left = `${a.left - w.left}px`;
    ants.style.top = `${a.top - w.top}px`;
    ants.setAttribute('width', String(width));
    ants.setAttribute('height', String(height));
    const rect = ants.querySelector('rect');
    if (rect) {
      rect.setAttribute('width', String(Math.max(0, width - 3)));
      rect.setAttribute('height', String(Math.max(0, height - 3)));
    }
  }, [tdFor, wrapRef]);

  const setClipboardSource = useCallback((cut) => {
    const rect = model.rect();
    if (!rect) return;
    clipRef.current = { rect, cut };
    repositionAnts();
  }, [model, repositionAnts]);

  const clearClipboardSource = useCallback(() => {
    clipRef.current = null;
    if (antsRef.current) antsRef.current.style.display = 'none';
  }, []);

  useEffect(() => {
    const unsubscribe = model.subscribe(() => { reposition(); refreshStats(); });
    // Layout shifts (column add/resize, zoom) move cells under the overlays —
    // the table resize observer pattern the sticky scrollbar already uses.
    const table = gridRef.current?.querySelector('table');
    const onLayout = () => { reposition(); repositionAnts(); };
    const ro = table ? new ResizeObserver(onLayout) : null;
    if (ro && table) ro.observe(table);
    return () => { unsubscribe(); ro?.disconnect(); };
  }, [model, reposition, refreshStats, repositionAnts, gridRef]);

  // ---- range operations -------------------------------------------------------
  const clearSelection = useCallback(() => {
    const scores = getScores?.() || {};
    const entries = [];
    model.forEachCell(({ rowId, col }) => {
      const v = scores?.[col.columnId]?.[rowId];
      if (v !== undefined && v !== null && v !== '') {
        entries.push({ column_id: col.columnId, student_id: rowId, value: null });
      }
    });
    if (entries.length === 0) return;
    onApplyRange?.(entries, `clear ${entries.length} score${entries.length === 1 ? '' : 's'}`);
  }, [model, getScores, onApplyRange]);

  // ---- clipboard (Phase 2b): TSV in and out via native events ----------------
  const copySelection = useCallback((clipboardData, cut) => {
    const rect = model.rect();
    if (!rect) return false;
    const text = serializeRange(model.geometry(), rect, getScores?.() || {}, formatNumber);
    if (clipboardData) clipboardData.setData('text/plain', text);
    else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    setClipboardSource(cut);
    return true;
  }, [model, getScores, setClipboardSource]);

  /**
   * Resolve parsed clipboard data into bulk entries and apply — behind the
   * preview dialog when the paste is destructive (replaces more than a
   * handful of existing scores, clips at the grid edge, or had to skip
   * non-numeric tokens). Small clean pastes apply instantly; undo covers
   * regret (one entry either way).
   */
  const runPaste = useCallback((data) => {
    if (!data) return;
    const g = model.geometry();
    const rect = model.rect();
    const anchor = rect ? { r: rect.r1, c: rect.c1 } : model.focus();
    if (!anchor) return;
    const { writes, skipped, clipped } = resolvePaste({
      rowCount: g.rows.length,
      colCount: g.cols.length,
      rect,
      anchor,
      data,
    });
    if (writes.length === 0 && skipped === 0) return;

    const scores = getScores?.() || {};
    const targeted = new Set();
    let replaced = 0;
    const entries = writes.map(w => {
      const col = g.cols[w.c];
      const rowId = g.rows[w.r];
      targeted.add(`${col.columnId}|${rowId}`);
      const existing = scores?.[col.columnId]?.[rowId];
      if (existing !== undefined && existing !== null && existing !== '') replaced += 1;
      return { column_id: col.columnId, student_id: rowId, value: w.value };
    });

    // A CUT pastes as a move: the source cells that were not overwritten by
    // the destination clear in the SAME bulk write (one undo entry restores
    // both sides).
    const clip = clipRef.current;
    const isMove = !!clip?.cut;
    if (isMove) {
      for (let r = clip.rect.r1; r <= clip.rect.r2; r++) {
        for (let c = clip.rect.c1; c <= clip.rect.c2; c++) {
          const col = g.cols[c];
          const rowId = g.rows[r];
          if (!col || rowId === undefined) continue;
          const key = `${col.columnId}|${rowId}`;
          const v = scores?.[col.columnId]?.[rowId];
          if (!targeted.has(key) && v !== undefined && v !== null && v !== '') {
            entries.push({ column_id: col.columnId, student_id: rowId, value: null });
          }
        }
      }
    }
    if (entries.length === 0) return;

    const label = isMove ? `move ${writes.length} score${writes.length === 1 ? '' : 's'}` : `paste ${writes.length} cell${writes.length === 1 ? '' : 's'}`;
    const apply = () => {
      onApplyRange?.(entries, label);
      // Select what was pasted (Excel does), and retire a cut marquee —
      // a plain copy stays live for repeat pastes until Escape.
      if (writes.length > 0) {
        const rMax = Math.max(...writes.map(w => w.r));
        const cMax = Math.max(...writes.map(w => w.c));
        suppressFocusSync.current = true;
        model.set(anchor.r, anchor.c);
        model.extendTo(rMax, cMax);
        suppressFocusSync.current = false;
      }
      if (isMove) clearClipboardSource();
    };

    if (replaced > 5 || clipped || skipped > 0) {
      const parts = [`This will set ${writes.length} cell${writes.length === 1 ? '' : 's'}`];
      if (replaced > 0) parts.push(`replacing ${replaced} existing score${replaced === 1 ? '' : 's'}`);
      if (skipped > 0) parts.push(`${skipped} skipped (not numbers)`);
      if (clipped) parts.push('clipped at the edge of the gradebook');
      setPending({ apply, label, message: `${parts.join(' · ')}.` });
    } else {
      apply();
    }
  }, [model, getScores, onApplyRange, clearClipboardSource]);

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
      if (e.key === 'Escape') {
        // Do NOT stop propagation: the cell's own Escape (cancel edit)
        // still runs; the range collapses and the marquee retires alongside.
        if (model.isMulti()) model.collapse();
        clearClipboardSource();
      }
    };

    // Clipboard: the grid handles multi-cell selections; a single cell keeps
    // the input's native copy/cut/paste (text within the cell). Native
    // events carry clipboardData with zero permission prompts, in Electron
    // and browser dev alike.
    const onCopy = (e) => {
      if (!model.isMulti()) return;
      e.preventDefault();
      copySelection(e.clipboardData, false);
    };
    const onCut = (e) => {
      if (!model.isMulti()) return;
      e.preventDefault();
      copySelection(e.clipboardData, true); // source clears when the paste lands
    };
    const onPaste = (e) => {
      const onScoreCell = !!e.target?.closest?.('input[data-cell="score"]');
      if (!onScoreCell) return;
      const data = parseClipboardText(e.clipboardData?.getData('text/plain') || '');
      if (!data) return;
      // Scalar into a single cell = the input's own paste (autosave flows).
      if (!model.isMulti() && data.length === 1 && data[0].length === 1 && !clipRef.current?.cut) return;
      e.preventDefault();
      runPaste(data);
    };

    const onContextMenu = (e) => {
      if (!onOpenMenu) return;
      const at = cellCoords(e.target);
      if (!at) return;
      if (!model.contains(at.r, at.c)) model.set(at.r, at.c);
      const multi = model.isMulti();
      const items = [
        // Menu clicks are user gestures, so the async clipboard API works;
        // paste falls back to a hint if the platform withholds read access.
        { label: 'Copy', onClick: () => copySelection(null, false) },
        { label: 'Cut', onClick: () => copySelection(null, true) },
        {
          label: 'Paste',
          onClick: () => {
            navigator.clipboard?.readText?.()
              .then(text => runPaste(parseClipboardText(text || '')))
              .catch(() => {});
          },
        },
      ];
      if (multi) items.push({ label: `Clear ${model.size()} cells`, danger: true, separatorBefore: true, onClick: () => clearSelection() });
      items.push({ label: 'Select column', separatorBefore: !multi, onClick: () => model.selectColumn(at.c) });
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
    grid.addEventListener('copy', onCopy);
    grid.addEventListener('cut', onCut);
    grid.addEventListener('paste', onPaste);
    return () => {
      grid.removeEventListener('focusin', onFocusIn);
      grid.removeEventListener('pointerdown', onPointerDown);
      grid.removeEventListener('pointermove', onPointerMove);
      grid.removeEventListener('pointerup', endDrag);
      grid.removeEventListener('pointercancel', endDrag);
      grid.removeEventListener('keydown', onKeyDown, true);
      grid.removeEventListener('contextmenu', onContextMenu);
      grid.removeEventListener('copy', onCopy);
      grid.removeEventListener('cut', onCut);
      grid.removeEventListener('paste', onPaste);
    };
  }, [gridRef, model, cellCoords, rowCoordFromNumberCell, onOpenMenu, clearSelection, copySelection, runPaste, clearClipboardSource]);

  return (
    <>
      <div ref={overlayRef} className="gb-sel-overlay" aria-hidden="true" />
      {/* Marching ants — the copied/cut source. An SVG rect with an animated
          dash offset is the one honest way to march a border in CSS. */}
      <svg ref={antsRef} className="gb-ants-overlay" aria-hidden="true">
        <rect x="1.5" y="1.5" rx="1" />
      </svg>
      {pending && (
        <ConfirmDialog
          open
          danger={false}
          title="Paste into the gradebook?"
          message={pending.message}
          confirmLabel="Paste"
          onConfirm={pending.apply}
          onClose={() => setPending(null)}
        />
      )}
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
