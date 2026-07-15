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
import { createSelectionModel, normalizeRect, computeSelectionStats, fillDownPlan, fillExtendPlan, scrollThumbMetrics } from '../src/lib/gridSelection.js';
import { serializeRange, parseClipboardText, normalizeToken, resolvePaste } from '../src/lib/tsv.js';

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

// ---- TSV clipboard (Phase 2b) --------------------------------------------------
{
  const g = geo([0, 1, 2], [0, 1]);
  const scores = { col0: { st0: 8, st1: 10 }, col1: { st0: 7.5 } };

  t('serialize: values, blanks as empty cells, tab/newline framing',
    serializeRange(g, { r1: 0, c1: 0, r2: 2, c2: 1 }, scores) === '8\t7.5\n10\t\n\t');

  const excel = parseClipboardText('8\t7.5\r\n10\t\r\n');
  t('parse: CRLF + Excel trailing newline', excel.length === 2 && excel[0][1] === '7.5' && excel[1][1] === '');
  t('parse: ragged rows are padded', parseClipboardText('1\t2\n3')[1].join(',') === '3,');
  t('parse: scalar', parseClipboardText('7')[0][0] === '7' && parseClipboardText('7').length === 1);
  t('parse: empty clipboard is null', parseClipboardText('') === null && parseClipboardText('  ') === null);

  t('token: numbers parse, blanks clear, junk skips',
    normalizeToken('7.5').value === 7.5 && normalizeToken(' 10 ').value === 10 &&
    normalizeToken('').clear === true && normalizeToken('abc').skip === true &&
    normalizeToken('1e5').skip === true);

  // Tiling: selection shape divisible by data shape in BOTH dimensions.
  const tile = resolvePaste({
    rowCount: 5, colCount: 5,
    rect: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 0, c: 0 },
    data: [['9']],
  });
  t('paste: scalar tiles the whole selection', tile.mode === 'tile' && tile.writes.length === 6 && tile.writes.every(w => w.value === 9));

  const rowTile = resolvePaste({
    rowCount: 5, colCount: 5,
    rect: { r1: 0, c1: 0, r2: 3, c2: 1 }, anchor: { r: 0, c: 0 },
    data: [['1', '2']],
  });
  t('paste: one row repeats down a divisible selection',
    rowTile.mode === 'tile' && rowTile.writes.length === 8 &&
    rowTile.writes.filter(w => w.c === 0).every(w => w.value === 1));

  const block = resolvePaste({
    rowCount: 5, colCount: 5,
    rect: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 0, c: 0 },
    data: [['1', '2'], ['3', '4']], // 2×2 into 3×2 selection: NOT divisible → block
  });
  t('paste: non-divisible selection falls back to block-at-anchor',
    block.mode === 'block' && block.writes.length === 4);

  const clipped = resolvePaste({
    rowCount: 3, colCount: 2,
    rect: null, anchor: { r: 2, c: 1 },
    data: [['1', '2'], ['3', '4']],
  });
  t('paste: blocks clip at the grid edges, never wrap',
    clipped.clipped === true && clipped.writes.length === 1 && clipped.writes[0].value === 1);

  const messy = resolvePaste({
    rowCount: 5, colCount: 5,
    rect: null, anchor: { r: 0, c: 0 },
    data: [['7', 'absent', '']],
  });
  t('paste: junk skips its cell, empty clears its cell',
    messy.skipped === 1 && messy.writes.length === 2 &&
    messy.writes[0].value === 7 && messy.writes[1].value === null);
}

// ---- fill (Phase 2c) ------------------------------------------------------------
{
  const down = fillDownPlan({ r1: 1, c1: 0, r2: 3, c2: 1 });
  t('fill down: top row repeats into every row below, per column',
    down.length === 4 && down.every(p => p.srcR === 1) &&
    down.filter(p => p.c === 0).map(p => p.dstR).join(',') === '2,3');
  t('fill down: single cell copies the cell above',
    JSON.stringify(fillDownPlan({ r1: 2, c1: 1, r2: 2, c2: 1 })) === JSON.stringify([{ srcR: 1, dstR: 2, c: 1 }]));
  t('fill down: first row / single-row selections have nothing to fill',
    fillDownPlan({ r1: 0, c1: 0, r2: 0, c2: 0 }).length === 0 &&
    fillDownPlan({ r1: 1, c1: 0, r2: 1, c2: 3 }).length === 0);

  const ext = fillExtendPlan({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 2, c1: 0, r2: 5, c2: 0 });
  t('drag fill: a 2-row source tiles a 4-row extension (pattern cycles)',
    ext.map(p => p.srcR).join(',') === '0,1,0,1' && ext.map(p => p.dstR).join(',') === '2,3,4,5');
  const extR = fillExtendPlan({ r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 0, c1: 2, r2: 0, c2: 4 });
  t('drag fill: rightward extension cycles the source columns',
    extR.map(p => p.srcC).join(',') === '0,1,0' && extR.map(p => p.dstC).join(',') === '2,3,4');
  t('drag fill: null inputs yield an empty plan', fillExtendPlan(null, null).length === 0);
}

// ---- dock scrollbar thumb metrics (v1.7.2) ---------------------------------------
{
  const half = scrollThumbMetrics(500, 1000, 400, 0);
  t('thumb: size is track × viewport/content', half.size === 200 && half.offset === 0);
  const end = scrollThumbMetrics(500, 1000, 400, 500);
  t('thumb: fully scrolled reaches the track end exactly', end.offset === end.maxOffset && end.offset === 200);
  const mid = scrollThumbMetrics(500, 1000, 400, 250);
  t('thumb: travel maps linearly', mid.offset === 100);
  t('thumb: clamps to a native-like minimum on huge content',
    scrollThumbMetrics(500, 50000, 400, 0).size === 24);
  t('thumb: no overflow → not scrollable, thumb fills the track',
    scrollThumbMetrics(1000, 900, 400).scrollable === false && scrollThumbMetrics(1000, 900, 400).size === 400);
}

console.log(failures === 0 ? '\nALL GRID SELECTION TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
