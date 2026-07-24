/**
 * Unit tests for the v1.8.0 formatting libraries — both PURE modules:
 *   · src/lib/shortCodes.js   (automatic assessment short codes)
 *   · src/lib/highlights.js   (configurable cell coloring rules)
 * Run: node scripts/test-formatting.mjs   (exits non-zero on any failure)
 */
import { assessmentCode, columnCodes, columnLongName, columnCodeInfo } from '../src/lib/shortCodes.js';
import {
  HIGHLIGHT_RULES,
  defaultHighlightConfig,
  normalizeHighlightConfig,
  resolveHighlight,
  moveHighlightRule,
} from '../src/lib/highlights.js';

let failures = 0;
const t = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

// ---- short codes (v1.9.0 convention) -------------------------------------------
{
  const codes = (name, n = 1, is_exam = 0) =>
    columnCodes({ name, is_exam, columns: Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) });

  t('codes: Quiz → Q1 Q2 Q3, sequential in column order', codes('Quiz', 3).join(' ') === 'Q1 Q2 Q3');
  // The A/AS/AT ambiguity triangle, dissolved: A = Attendance (the most
  // frequent category earns the shortest code), ACT = Activity, AS = Assignment.
  t('codes: Attendance → A (the bare A)', assessmentCode({ name: 'Attendance' }) === 'A');
  t('codes: Activity → ACT', assessmentCode({ name: 'Activity' }) === 'ACT');
  t('codes: Activities (plural) → ACT', assessmentCode({ name: 'Activities' }) === 'ACT');
  t('codes: Assignment → AS', assessmentCode({ name: 'Assignment' }) === 'AS');
  t('codes: Laboratory → L', assessmentCode({ name: 'Laboratory' }) === 'L');
  t('codes: Lab → L', assessmentCode({ name: 'Lab' }) === 'L');
  t('codes: Seatwork → SW', assessmentCode({ name: 'Seatwork' }) === 'SW');
  t('codes: Seat Work (spaced) → SW', assessmentCode({ name: 'Seat Work' }) === 'SW');
  t('codes: Performance Task → PT', assessmentCode({ name: 'Performance Task' }) === 'PT');
  t('codes: Project → P', assessmentCode({ name: 'Project' }) === 'P');
  t('codes: Recitation → R', assessmentCode({ name: 'Recitation' }) === 'R');
  t('codes: Oral Participation → OP', assessmentCode({ name: 'Oral Participation' }) === 'OP');
  t('codes: Reporting → REP', assessmentCode({ name: 'Reporting' }) === 'REP');
  t('codes: case-insensitive (qUiZ → Q)', assessmentCode({ name: 'qUiZ' }) === 'Q');
  t('codes: is_exam always wins → E', assessmentCode({ name: 'Final Examination', is_exam: 1 }) === 'E');
  t('codes: everything is numbered — the exam included (E1, one rule, no exceptions)',
    columnCodes({ name: 'Exam', is_exam: 1, columns: [{ id: 'c0' }] }).join('') === 'E1');
  t('codes: multi-word fallback → word initials (Machine Problem → MP)',
    assessmentCode({ name: 'Machine Problem' }) === 'MP');
  t('codes: single-word fallback → first two letters (Portfolio → PO)',
    assessmentCode({ name: 'Portfolio' }) === 'PO');
  t('codes: numbering restarts per assessment', codes('Seatwork', 2).join(' ') === 'SW1 SW2');
  t('codes: empty columns → empty list', codes('Quiz', 0).length === 0);
  // The re-ordering guarantee is BY CONSTRUCTION: codes come from array
  // positions, so the same columns in a different order re-number.
  const a = { name: 'Quiz', is_exam: 0 };
  const c1 = { id: 'c1' }, c2 = { id: 'c2' };
  t('codes: reordering columns renumbers (derived, nothing stored)',
    columnCodes(a, [c1, c2])[0] === 'Q1' && columnCodes(a, [c2, c1])[0] === 'Q1');

  // Manual labels (v1.9.0): preserved forever, never shifting neighbors.
  const cols = [{ id: 'c1', label: '' }, { id: 'c2', label: 'Long Quiz' }, { id: 'c3', label: '' }];
  t('codes: a manual label overrides its own column only',
    columnCodes(a, cols).join(' ') === 'Q1 Long Quiz Q3');
  t('codes: automatic numbering stays positional around manual labels',
    columnCodes(a, cols)[2] === 'Q3');
  const info = columnCodeInfo(a, cols);
  t('codes: info marks manual vs automatic', info[1].manual === true && info[0].manual === false);
  t('codes: the tooltip long form is the actual assessment name ("Quiz 2"), never "automatic"',
    columnLongName(a, 1) === 'Quiz 2' && info[1].long === 'Quiz 2');
  t('codes: info carries the underlying auto code for edit round-trips', info[1].auto === 'Q2');
  t('codes: whitespace-only labels stay automatic', columnCodes(a, [{ id: 'c1', label: '   ' }])[0] === 'Q1');
}

// ---- highlight config --------------------------------------------------------
{
  const def = defaultHighlightConfig();
  t('hl: default config carries every registry rule, in registry order',
    def.order.length === HIGHLIGHT_RULES.length && def.order.every((id, i) => HIGHLIGHT_RULES[i].id === id));
  t('hl: normalize(null) → defaults', JSON.stringify(normalizeHighlightConfig(null)) === JSON.stringify(def));
  t('hl: unknown rule ids are dropped',
    !normalizeHighlightConfig({ order: ['bogus', 'missing'], rules: {} }).order.includes('bogus'));
  t('hl: saved priority is kept, new registry rules appended',
    normalizeHighlightConfig({ order: ['zero', 'missing'], rules: {} }).order.slice(0, 2).join(',') === 'zero,missing');
  t('hl: thresholds clamp to the rule range',
    normalizeHighlightConfig({ rules: { failedScore: { threshold: 900 } } }).rules.failedScore.threshold === 100);
  t('hl: bad colors fall back to defaults',
    normalizeHighlightConfig({ rules: { missing: { bg: 42 } } }).rules.missing.bg === def.rules.missing.bg);
  t('hl: enabled flags survive normalization',
    normalizeHighlightConfig({ rules: { zero: { enabled: true } } }).rules.zero.enabled === true);
}

// ---- highlight resolution ----------------------------------------------------
{
  const def = defaultHighlightConfig();
  const on = (ids) => {
    const c = defaultHighlightConfig();
    for (const id of c.order) c.rules[id] = { ...c.rules[id], enabled: ids.includes(id) };
    return c;
  };

  t('hl: empty cell → missing (default on)', resolveHighlight('score', { value: '', max: 10 }, def)?.id === 'missing');
  t('hl: null value → missing', resolveHighlight('score', { value: null, max: 10 }, def)?.id === 'missing');
  t('hl: over max → overMax (default on)', resolveHighlight('score', { value: '12', max: 10 }, def)?.id === 'overMax');
  t('hl: ordinary score → no highlight', resolveHighlight('score', { value: '8', max: 10 }, def) === null);
  t('hl: zero is OFF by default', resolveHighlight('score', { value: '0', max: 10 }, def) === null);
  t('hl: zero rule matches 0 when enabled', resolveHighlight('score', { value: '0', max: 10 }, on(['zero']))?.id === 'zero');
  t('hl: empty cell never matches zero (Number("") trap)',
    resolveHighlight('score', { value: '', max: 10 }, on(['zero'])) === null);

  const failCfg = on(['failedScore']);
  t('hl: 5/10 with passing 60% → failedScore', resolveHighlight('score', { value: '5', max: 10 }, failCfg)?.id === 'failedScore');
  t('hl: exactly at the passing % is NOT failed', resolveHighlight('score', { value: '6', max: 10 }, failCfg) === null);
  failCfg.rules.failedScore.threshold = 50;
  t('hl: threshold is configurable (50% → 5/10 passes)', resolveHighlight('score', { value: '5', max: 10 }, failCfg) === null);
  t('hl: max of 0 never divides (no NaN match)', resolveHighlight('score', { value: '3', max: 0 }, on(['failedScore'])) === null);

  t('hl: period grade below 75 → failedPeriodGrade (default on)',
    resolveHighlight('periodGrade', { grade: 72.4 }, def)?.id === 'failedPeriodGrade');
  t('hl: period grade at exactly 75 passes', resolveHighlight('periodGrade', { grade: 75 }, def) === null);
  t('hl: cents-safe compare (74.999 vs 75 rounds to a pass)',
    resolveHighlight('periodGrade', { grade: 74.999 }, def) === null);
  t('hl: null grade (no scores yet) → no highlight', resolveHighlight('periodGrade', { grade: null }, def) === null);
  t('hl: final grade below 75 → failedFinalGrade', resolveHighlight('finalGrade', { grade: 60 }, def)?.id === 'failedFinalGrade');
  t('hl: kinds never cross (score rules ignore grade cells)',
    resolveHighlight('periodGrade', { grade: 0 }, on(['zero'])) === null);

  // Priority: first match in USER order wins. A zero score matches both
  // 'zero' and 'failedScore' — whichever the user ranked higher colors it.
  const both = on(['zero', 'failedScore']);
  t('hl: priority — zero above failedScore → zero wins',
    resolveHighlight('score', { value: '0', max: 10 }, both)?.id === 'zero');
  const swapped = moveHighlightRule(both, 'failedScore', -1); // above zero
  t('hl: reordering flips the winner (first match wins)',
    resolveHighlight('score', { value: '0', max: 10 }, swapped)?.id === 'failedScore');
  t('hl: moveHighlightRule is pure (original unchanged)',
    both.order.indexOf('zero') < both.order.indexOf('failedScore'));
  t('hl: moving past the ends is a no-op', moveHighlightRule(both, both.order[0], -1) === both);

  // The resolved colors come from the CONFIG (user-edited), not the registry.
  const tinted = on(['missing']);
  tinted.rules.missing = { ...tinted.rules.missing, bg: '#123456', fg: '#654321' };
  const hit = resolveHighlight('score', { value: '', max: 10 }, tinted);
  t('hl: resolved colors are the user-configured ones', hit.bg === '#123456' && hit.fg === '#654321');
}

console.log(failures === 0 ? '\nALL FORMATTING TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
