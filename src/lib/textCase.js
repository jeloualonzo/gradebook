/**
 * Text case conversion — ONE reusable utility for the whole app (bulk name
 * cleanup, the global Shift+F3 shortcut, any future surface).
 *
 * Title Case capitalizes the first letter of every word, including after
 * hyphens, apostrophes, and periods: "juan dela cruz" → "Juan Dela Cruz",
 * "anne-marie o'brien" → "Anne-Marie O'Brien".
 */

export function toUpperCase(s) {
  return String(s ?? '').toUpperCase();
}

export function toLowerCase(s) {
  return String(s ?? '').toLowerCase();
}

export function toTitleCase(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/(^|[\s\-'’.("])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

export const CASE_MODES = [
  { id: 'upper', label: 'UPPERCASE', apply: toUpperCase },
  { id: 'lower', label: 'lowercase', apply: toLowerCase },
  { id: 'title', label: 'Title Case', apply: toTitleCase },
];

export function applyCase(s, modeId) {
  const mode = CASE_MODES.find(m => m.id === modeId);
  return mode ? mode.apply(s) : String(s ?? '');
}

/**
 * Word-style Shift+F3 cycling: UPPERCASE → lowercase → Title Case → … based
 * on what the text currently looks like.
 */
export function cycleCase(s) {
  const str = String(s ?? '');
  if (!str.trim()) return str;
  if (str === str.toUpperCase() && str !== str.toLowerCase()) return str.toLowerCase();
  if (str === str.toLowerCase()) return toTitleCase(str);
  return str.toUpperCase();
}
