/**
 * Clipboard TSV — PURE. No DOM, no React, no I/O.
 *
 * The gradebook's interchange format with the outside world (ROADMAP Phase
 * 2b). Excel, Google Sheets, LibreOffice, and Notepad all speak plain-text
 * TSV on the clipboard: rows joined by newlines, cells by tabs. Everything
 * decision-shaped about copy/paste lives here where plain Node can test it;
 * the event wiring in GridSelectionLayer stays a thin shell.
 */

/** Serialize a selection rectangle as TSV (blanks travel as empty cells). */
export function serializeRange(geometry, rect, scores, formatValue) {
  const lines = [];
  for (let r = rect.r1; r <= rect.r2; r++) {
    const studentId = geometry.rows[r];
    const cells = [];
    for (let c = rect.c1; c <= rect.c2; c++) {
      const col = geometry.cols[c];
      const raw = scores?.[col?.columnId]?.[studentId];
      cells.push(raw === undefined || raw === null || raw === '' ? '' : String(formatValue ? formatValue(raw) : raw));
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Parse clipboard text into a rectangular string matrix.
 * Handles \r\n (Windows/Excel) and the single trailing newline Excel appends
 * to every copy. Ragged rows are padded with empty cells (some apps emit
 * them); a fully empty clipboard returns null.
 */
export function parseClipboardText(text) {
  if (typeof text !== 'string' || text === '') return null;
  let rows = text.split(/\r\n|\r|\n/);
  if (rows.length > 1 && rows[rows.length - 1] === '') rows = rows.slice(0, -1); // Excel's trailing newline
  if (rows.length === 0) return null;
  const matrix = rows.map(line => line.split('\t'));
  const width = Math.max(...matrix.map(r => r.length));
  for (const r of matrix) while (r.length < width) r.push('');
  if (matrix.length === 1 && width === 1 && matrix[0][0].trim() === '') return null;
  return matrix;
}

/**
 * Normalize one clipboard token for a score cell.
 *   ''            → { clear: true }          (empty pastes as empty — Excel)
 *   numeric text  → { value: number }        (same parse path as typing)
 *   anything else → { skip: true }           (never guess; leave the cell)
 */
export function normalizeToken(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { clear: true };
  const n = parseFloat(s);
  if (Number.isFinite(n) && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { value: n };
  return { skip: true };
}

/**
 * Resolve WHERE a parsed matrix lands (Excel's placement rules, one rule):
 *
 * - If the selection is multi-cell and its shape is an exact multiple of the
 *   data shape in BOTH dimensions → TILE the data across the selection
 *   (this single rule covers "scalar fills the selection" and "one row/
 *   column repeats" — a 1×1 divides everything).
 * - Otherwise → paste the block at the ANCHOR cell, clipped at the grid
 *   edges (never wraps, never scrolls data).
 *
 * Returns { writes: [{ r, c, value|null }], skipped, clipped, mode } —
 * skipped counts non-numeric tokens (their cells stay untouched); null
 * values clear their cells.
 */
export function resolvePaste({ rowCount, colCount, rect, anchor, data }) {
  const dr = data.length;
  const dc = data[0]?.length || 0;
  if (dr === 0 || dc === 0) return { writes: [], skipped: 0, clipped: false, mode: 'none' };

  const writes = [];
  let skipped = 0;
  const put = (r, c, token) => {
    const t = normalizeToken(token);
    if (t.skip) { skipped += 1; return; }
    writes.push({ r, c, value: t.clear ? null : t.value });
  };

  const isMulti = !!rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
  const selRows = rect ? rect.r2 - rect.r1 + 1 : 1;
  const selCols = rect ? rect.c2 - rect.c1 + 1 : 1;

  if (isMulti && selRows % dr === 0 && selCols % dc === 0) {
    for (let r = 0; r < selRows; r++) {
      for (let c = 0; c < selCols; c++) {
        put(rect.r1 + r, rect.c1 + c, data[r % dr][c % dc]);
      }
    }
    return { writes, skipped, clipped: false, mode: 'tile' };
  }

  let clipped = false;
  for (let r = 0; r < dr; r++) {
    for (let c = 0; c < dc; c++) {
      const rr = anchor.r + r;
      const cc = anchor.c + c;
      if (rr >= rowCount || cc >= colCount) { clipped = true; continue; }
      put(rr, cc, data[r][c]);
    }
  }
  return { writes, skipped, clipped, mode: 'block' };
}
