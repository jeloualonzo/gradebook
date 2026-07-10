/**
 * Unit tests for the PURE grid selection model (src/lib/gridSelection.js).
 * Run: node scripts/test-grid-selection.mjs   (exits non-zero on any failure)
 *
 * The selection engine is the foundation of ROADMAP Phase 2 — these fixtures
 * pin the state machine (anchors, extends, clamps, row/column/all selects,
 * geometry-change collapse) and the stats math the selection pill displays.
 * The imperative shell (overlays, pointer events) stays deliberately thin;
 * everything decision-shaped lives here where plain Node can test it.
 */
import { createSelectionModel, normalizeRect, computeSelectionStats } from '../src/lib/gridSelection.js';

let failures = 0;
const t = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const geo = (rows, cols) => ({
  rows: rows.map(r => `st${r}`),
  cols: cols.map(c => ({ columnId: `col${c}`, assessmentId: 'a1', periodId: 'p1' })),
});
const rectEq = (a, b) => a && b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

// ---- normalizeRect -----------------------------------------------------------
t('normalize: reversed anchors produce the same rectangle',
  rectEq(normalizeRect({ r: 3, c: 4 }, { r: 1, c: 2 }), { r1: 1, c1: 2, r2: 3, c2: 4 }));

// ---- basic transitions ---------------------------------------------------------
{
  const m = createSelectionModel();
  m.setGeometry(geo([0, 1, 2, 3, 4], [0, 1, 2, 3]));
  let notified = 0;
  m.subscribe(() => { notified += 1; });

  t('empty model starts with no rect', m.rect() === null && m.size() === 0);
  m.set(1, 1);
  t('set: single cell (anchor = focus)', rectEq(m.rect(), { r1: 1, c1: 1, r2: 1, c2: 1 }) && !m.isMulti());
  m.extendTo(3, 2);
  t('extendTo: rectangle from anchor', rectEq(m.rect(), { r1: 1, c1: 1, r2: 3, c2: 2 }) && m.isMulti());
  t('size counts inclusively', m.size() === 6);
  m.extendTo(0, 0);
  t('extend past the anchor flips the rectangle', rectEq(m.rect(), { r1: 0, c1: 0, r2: 1, c2: 1 }));
  m.moveFocus(1, 0, { extend: true });
  t('Shift+Arrow keeps the anchor', m.anchor().r === 1 && m.anchor().c === 1 && m.focus().r === 1);
  m.moveFocus(1, 0);
  t('plain move collapses to the new cell', !m.isMulti() && m.focus().r === 2);
  m.moveFocus(99, 99, { extend: true });
  t('extension clamps at the grid edges', rectEq(m.rect(), { r1: 2, c1: 0, r2: 4, c2: 3 }));
  m.collapse();
  t('collapse shrinks to the focus cell', !m.isMulti() && m.focus().r === 4 && m.focus().c === 3);
  m.clear();
  t('clear removes the selection entirely', m.rect() === null);
  t('every transition notified subscribers (8 transitions above)', notified === 8);
}

// ---- row / column / all --------------------------------------------------------
{
  const m = createSelectionModel();
  m.setGeometry(geo([0, 1, 2, 3], [0, 1, 2]));
  m.selectRow(2);
  t('selectRow spans every column', rectEq(m.rect(), { r1: 2, c1: 0, r2: 2, c2: 2 }));
  m.extendRowTo(0);
  t('extendRowTo spans the row range, all columns', rectEq(m.rect(), { r1: 0, c1: 0, r2: 2, c2: 2 }));
  m.selectColumn(1);
  t('selectColumn spans every student', rectEq(m.rect(), { r1: 0, c1: 1, r2: 3, c2: 1 }));
  m.selectAll();
  t('selectAll covers the whole grid', m.size() === 12);
  t('contains answers membership', m.contains(3, 2) && m.contains(0, 0));

  const visited = [];
  m.set(1, 1); m.extendTo(2, 2);
  m.forEachCell(({ rowId, col }) => visited.push(`${rowId}:${col.columnId}`));
  t('forEachCell walks row-major with resolved ids',
    visited.join(' ') === 'st1:col1 st1:col2 st2:col1 st2:col2');
}

// ---- geometry changes ------------------------------------------------------------
{
  const m = createSelectionModel();
  m.setGeometry(geo([0, 1, 2, 3], [0, 1, 2, 3]));
  m.set(1, 1); m.extendTo(3, 3);
  m.setGeometry(geo([0, 1, 2, 3], [0, 1, 2, 3]));
  t('identical geometry keeps the selection', m.isMulti() && m.size() === 9);
  m.setGeometry(geo([0, 1, 2, 3], [0, 1, 2])); // a column disappeared
  t('changed structure collapses to the clamped focus cell',
    !m.isMulti() && m.focus().r === 3 && m.focus().c === 2);
  m.setGeometry(geo([], []));
  t('empty geometry clears the selection', m.rect() === null);
}

// ---- stats -------------------------------------------------------------------------
{
  const g = geo([0, 1, 2], [0, 1]);
  const scores = {
    col0: { st0: 8, st1: 10 },          // st2 blank
    col1: { st0: '7.5', st2: null },    // string values arrive from the API; null = cleared
  };
  const s = computeSelectionStats(g, { r1: 0, c1: 0, r2: 2, c2: 1 }, scores);
  t('stats: counts every cell in the rectangle', s.cells === 6);
  t('stats: blanks and nulls are missing, values are values', s.values === 3 && s.missing === 3);
  t('stats: high/low/avg over entered values only',
    s.high === 10 && s.low === 7.5 && Math.round(s.avg * 100) === Math.round((25.5 / 3) * 100));
  const single = computeSelectionStats(g, { r1: 0, c1: 0, r2: 0, c2: 0 }, scores);
  t('stats: single filled cell', single.cells === 1 && single.values === 1 && single.missing === 0);
  t('stats: null rect yields null', computeSelectionStats(g, null, scores) === null);
}

console.log(failures === 0 ? '\nALL GRID SELECTION TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
