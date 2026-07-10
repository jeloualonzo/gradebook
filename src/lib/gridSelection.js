/**
 * Grid selection model — PURE. No DOM, no React, no I/O.
 *
 * The gradebook's selection engine (ROADMAP Phase 2; design doc "Phase 2
 * Design"). Owned by the grid via a ref and consumed imperatively: state
 * changes notify subscribers, which reposition overlays and stats — React
 * never re-renders a cell because the selection moved. ScoreCell knows
 * nothing about this module; that is the point.
 *
 * Coordinates, not ids: selection lives in { r, c } grid indices against a
 * GEOMETRY (visible column order + roster row order). Ids resolve through
 * the geometry at operation time. On any structural change the selection
 * collapses to the focus cell (clamped) — Excel's own answer to the ground
 * shifting mid-selection; a rectangle is never remapped across an edit.
 *
 * v1 is a single rectangular range. The read API (rect/contains/size/
 * forEachCell) already abstracts the shape, so a future `ranges: Rect[]`
 * (Ctrl+Click multi-range) extends the state without touching consumers.
 */

/** Normalize an anchor/focus pair into an inclusive rectangle. */
export function normalizeRect(anchor, focus) {
  return {
    r1: Math.min(anchor.r, focus.r),
    c1: Math.min(anchor.c, focus.c),
    r2: Math.max(anchor.r, focus.r),
    c2: Math.max(anchor.c, focus.c),
  };
}

/**
 * Selection statistics for the stats pill — pure math over the scores map.
 * Blank cells count as `missing`; avg/high/low cover entered values only.
 * (Display formatting stays with the caller; this returns raw numbers.)
 */
export function computeSelectionStats(geometry, rect, scores) {
  if (!rect) return null;
  let cells = 0;
  let values = 0;
  let sum = 0;
  let high = null;
  let low = null;
  for (let r = rect.r1; r <= rect.r2; r++) {
    const studentId = geometry.rows[r];
    for (let c = rect.c1; c <= rect.c2; c++) {
      const col = geometry.cols[c];
      if (!col || studentId === undefined) continue;
      cells += 1;
      const raw = scores?.[col.columnId]?.[studentId];
      const v = raw === undefined || raw === null || raw === '' ? null : parseFloat(raw);
      if (v === null || Number.isNaN(v)) continue;
      values += 1;
      sum += v;
      if (high === null || v > high) high = v;
      if (low === null || v < low) low = v;
    }
  }
  return { cells, values, missing: cells - values, avg: values ? sum / values : null, high, low };
}

export function createSelectionModel() {
  let geometry = { rows: [], cols: [] };
  let geometrySignature = '';
  let sel = null; // { anchor: {r,c}, focus: {r,c} } | null
  const listeners = new Set();

  const clampR = (r) => Math.max(0, Math.min(geometry.rows.length - 1, r));
  const clampC = (c) => Math.max(0, Math.min(geometry.cols.length - 1, c));
  const empty = () => geometry.rows.length === 0 || geometry.cols.length === 0;
  const notify = () => { for (const fn of listeners) fn(); };

  const api = {
    /**
     * Install the current grid geometry. A changed structure (columns or
     * roster) collapses the selection to the clamped focus cell; an
     * identical structure (same signature) keeps the selection as is.
     */
    setGeometry(g) {
      geometry = g || { rows: [], cols: [] };
      const signature = `${geometry.rows.join(',')}|${geometry.cols.map(c => c.columnId).join(',')}`;
      const changed = signature !== geometrySignature;
      geometrySignature = signature;
      if (!changed || !sel) return;
      if (empty()) { sel = null; notify(); return; }
      const f = { r: clampR(sel.focus.r), c: clampC(sel.focus.c) };
      sel = { anchor: f, focus: f };
      notify();
    },

    geometry() { return geometry; },

    /** Collapse the selection to one cell (anchor = focus). */
    set(r, c) {
      if (empty()) return;
      const cell = { r: clampR(r), c: clampC(c) };
      sel = { anchor: cell, focus: cell };
      notify();
    },

    /** Extend from the existing anchor (or start one) to the target cell. */
    extendTo(r, c) {
      if (empty()) return;
      const focus = { r: clampR(r), c: clampC(c) };
      sel = { anchor: sel ? sel.anchor : focus, focus };
      notify();
    },

    /** Arrow-key movement. extend=true keeps the anchor (Shift+Arrow). */
    moveFocus(dr, dc, { extend = false } = {}) {
      if (empty()) return;
      const from = sel ? sel.focus : { r: 0, c: 0 };
      const to = { r: clampR(from.r + dr), c: clampC(from.c + dc) };
      sel = extend && sel ? { anchor: sel.anchor, focus: to } : { anchor: to, focus: to };
      notify();
    },

    selectRow(r) {
      if (empty()) return;
      const rr = clampR(r);
      sel = { anchor: { r: rr, c: 0 }, focus: { r: rr, c: geometry.cols.length - 1 } };
      notify();
    },

    /** Shift+Click on another row number: span rows, all columns. */
    extendRowTo(r) {
      if (empty()) return;
      const rr = clampR(r);
      const anchorRow = sel ? sel.anchor.r : rr;
      sel = { anchor: { r: anchorRow, c: 0 }, focus: { r: rr, c: geometry.cols.length - 1 } };
      notify();
    },

    selectColumn(c) {
      if (empty()) return;
      const cc = clampC(c);
      sel = { anchor: { r: 0, c: cc }, focus: { r: geometry.rows.length - 1, c: cc } };
      notify();
    },

    selectAll() {
      if (empty()) return;
      sel = { anchor: { r: 0, c: 0 }, focus: { r: geometry.rows.length - 1, c: geometry.cols.length - 1 } };
      notify();
    },

    /** Shrink to the focus cell (Escape with a range active). */
    collapse() {
      if (!sel) return;
      sel = { anchor: sel.focus, focus: sel.focus };
      notify();
    },

    clear() {
      if (!sel) return;
      sel = null;
      notify();
    },

    rect() { return sel ? normalizeRect(sel.anchor, sel.focus) : null; },
    focus() { return sel ? sel.focus : null; },
    anchor() { return sel ? sel.anchor : null; },
    isMulti() {
      const r = api.rect();
      return !!r && (r.r1 !== r.r2 || r.c1 !== r.c2);
    },
    size() {
      const r = api.rect();
      return r ? (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) : 0;
    },
    contains(r, c) {
      const x = api.rect();
      return !!x && r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2;
    },

    /** Visit every selected cell as { r, c, rowId, col } (row-major order). */
    forEachCell(fn) {
      const x = api.rect();
      if (!x) return;
      for (let r = x.r1; r <= x.r2; r++) {
        for (let c = x.c1; c <= x.c2; c++) {
          fn({ r, c, rowId: geometry.rows[r], col: geometry.cols[c] });
        }
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}
