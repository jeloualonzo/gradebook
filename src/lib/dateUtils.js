/**
 * Date utilities for the gradebook.
 *
 * All calendar-date handling in this app is intentionally 100% STRING-based.
 * We never parse a date-only value with `new Date('YYYY-MM-DD')` because that
 * interprets the string as UTC midnight — for timezones ahead of UTC it then
 * renders as the *previous* day, and every save cycle shifts the date one more
 * day back. Keeping dates as plain 'YYYY-MM-DD' strings end-to-end guarantees
 * the exact date the instructor picked is stored and displayed verbatim.
 */

/**
 * Normalize any incoming date value to the HTML date-input format 'YYYY-MM-DD'.
 * Accepts plain 'YYYY-MM-DD' strings, 'YYYY-MM-DD HH:MM:SS' (mysql2
 * dateStrings) and legacy ISO strings like '2026-06-15T16:00:00.000Z'.
 * Returns '' for empty/null values.
 */
export function toDateInputValue(dateVal) {
  if (!dateVal) return '';
  const m = String(dateVal).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * The single display format used everywhere in the app: MM/DD/YYYY.
 * Returns '--' when no date is set.
 */
export function formatDateMMDDYYYY(dateVal) {
  const iso = toDateInputValue(dateVal);
  if (!iso) return '--';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * Today's date in the user's LOCAL timezone as 'YYYY-MM-DD'.
 * (`new Date().toISOString()` would give the UTC date, which can be a
 * different calendar day than the user's.)
 */
export function todayLocalISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
