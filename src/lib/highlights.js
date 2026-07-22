/**
 * Configurable gradebook highlighting (v1.8.0) — Excel's conditional
 * formatting, sized for a class record. PURE module: no React, no DOM, no
 * storage — unit-tested in scripts/test-formatting.mjs. Persistence and
 * rendering live with the callers.
 *
 * Model:
 * - HIGHLIGHT_RULES is the REGISTRY: every rule the app knows, each with a
 *   predicate (`matches`), the cell kind it applies to, and its defaults.
 *   Adding a future rule = one entry here + nothing else (settings UI,
 *   normalization, and resolution are all registry-driven).
 * - The user CONFIG stores only presentation: rule order (priority),
 *   enabled, background/text colors, and a threshold where the rule has
 *   one. Predicates are never user-defined — teachers pick what to show,
 *   not how it's computed.
 * - resolveHighlight walks config.order and returns the FIRST enabled rule
 *   that matches (Excel's "stop if true"). Priority is therefore fully
 *   deterministic and user-controlled.
 * - Config is persisted per DEVICE (localStorage) by the callers: coloring
 *   is a viewing preference, never synced data.
 *
 * Cell kinds: 'score' (a raw score cell), 'periodGrade' (the computed
 * PRELIM/MIDTERM/FINAL grade), 'finalGrade' (the semester final grade).
 */

// Cents-safe "a < b" for computed floats (74.999999 must not read as < 75
// after display rounding says 75.00 — same policy as db.valuesEqual).
const ltCents = (a, b) => Math.round(a * 100) < Math.round(b * 100);

export const HIGHLIGHT_RULES = [
  {
    id: 'overMax',
    kind: 'score',
    label: 'Over max score',
    description: 'A score higher than the column’s max — usually a typo.',
    defaults: { enabled: true, bg: '#fef2f2', fg: '#b91c1c' },
    matches: (cfg, { value, max }) =>
      value != null && value !== '' && Number(value) > Number(max),
  },
  {
    id: 'missing',
    kind: 'score',
    label: 'Missing score',
    description: 'An empty cell — no score entered yet.',
    defaults: { enabled: true, bg: '#fef9c3', fg: '#a16207' },
    matches: (cfg, { value }) => value == null || value === '',
  },
  {
    id: 'zero',
    kind: 'score',
    label: 'Zero score',
    description: 'An entered score of exactly 0.',
    defaults: { enabled: false, bg: '#fee2e2', fg: '#b91c1c' },
    matches: (cfg, { value }) =>
      value != null && value !== '' && Number(value) === 0,
  },
  {
    id: 'failedScore',
    kind: 'score',
    label: 'Failed assessment score',
    description: 'A score below the passing percentage of the column’s max.',
    threshold: { label: 'Passing %', min: 1, max: 100 },
    defaults: { enabled: false, bg: '#fff7ed', fg: '#c2410c', threshold: 60 },
    matches: (cfg, { value, max }) => {
      if (value == null || value === '') return false;
      const m = Number(max);
      if (!(m > 0)) return false;
      return ltCents((Number(value) / m) * 100, Number(cfg.threshold));
    },
  },
  {
    id: 'failedPeriodGrade',
    kind: 'periodGrade',
    label: 'Failed period grade',
    description: 'A computed PRELIM/MIDTERM/FINAL grade below passing.',
    threshold: { label: 'Passing grade', min: 1, max: 100 },
    defaults: { enabled: true, bg: '#fef2f2', fg: '#dc2626', threshold: 75 },
    matches: (cfg, { grade }) =>
      grade != null && ltCents(Number(grade), Number(cfg.threshold)),
  },
  {
    id: 'failedFinalGrade',
    kind: 'finalGrade',
    label: 'Failed final grade',
    description: 'A semester final grade below passing.',
    threshold: { label: 'Passing grade', min: 1, max: 100 },
    defaults: { enabled: true, bg: '#fef2f2', fg: '#dc2626', threshold: 75 },
    matches: (cfg, { grade }) =>
      grade != null && ltCents(Number(grade), Number(cfg.threshold)),
  },
];

const byId = new Map(HIGHLIGHT_RULES.map(r => [r.id, r]));

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A fresh config carrying every registry rule at its defaults. */
export function defaultHighlightConfig() {
  const rules = {};
  for (const r of HIGHLIGHT_RULES) rules[r.id] = { ...r.defaults };
  return { order: HIGHLIGHT_RULES.map(r => r.id), rules };
}

/**
 * Coerce anything (old versions, hand-edited storage, null) into a valid
 * config: unknown rule ids are dropped, missing ones are appended in
 * registry order (a future app version adding a rule keeps the user's
 * saved priorities and slots the new rule in), colors fall back to
 * defaults, thresholds clamp to the rule's range.
 */
export function normalizeHighlightConfig(raw) {
  const base = defaultHighlightConfig();
  if (!raw || typeof raw !== 'object') return base;

  const savedOrder = Array.isArray(raw.order) ? raw.order.filter(id => byId.has(id)) : [];
  const order = [...savedOrder];
  for (const id of base.order) if (!order.includes(id)) order.push(id);

  const rules = {};
  for (const reg of HIGHLIGHT_RULES) {
    const d = reg.defaults;
    const s = raw.rules && typeof raw.rules === 'object' ? raw.rules[reg.id] : null;
    const out = {
      enabled: typeof s?.enabled === 'boolean' ? s.enabled : d.enabled,
      bg: typeof s?.bg === 'string' && s.bg ? s.bg : d.bg,
      fg: typeof s?.fg === 'string' && s.fg ? s.fg : d.fg,
    };
    if (reg.threshold) {
      const t = Number(s?.threshold);
      out.threshold = Number.isFinite(t)
        ? clamp(t, reg.threshold.min, reg.threshold.max)
        : d.threshold;
    }
    rules[reg.id] = out;
  }
  return { order, rules };
}

/**
 * First enabled matching rule for a cell, in the config's priority order.
 * Returns { id, bg, fg } or null (no highlight).
 * ctx: { value, max } for kind 'score'; { grade } for the grade kinds.
 */
export function resolveHighlight(kind, ctx, config) {
  for (const id of config.order) {
    const reg = byId.get(id);
    if (!reg || reg.kind !== kind) continue;
    const cfg = config.rules[id];
    if (!cfg || !cfg.enabled) continue;
    if (reg.matches(cfg, ctx)) return { id, bg: cfg.bg, fg: cfg.fg };
  }
  return null;
}

/** Move a rule one step up/down in priority. Returns a NEW config. */
export function moveHighlightRule(config, ruleId, delta) {
  const i = config.order.indexOf(ruleId);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= config.order.length) return config;
  const order = [...config.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { ...config, order };
}
