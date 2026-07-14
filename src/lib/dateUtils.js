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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * 'YYYY-MM-DD' → 'July 8, 2026' — parsed by string parts, never new Date()
 * (see the module comment: date-only values must not shift across timezones).
 */
export function formatDateLong(dateVal) {
  const iso = toDateInputValue(dateVal);
  if (!iso) return '--';
  const [y, m, d] = iso.split('-');
  return `${MONTH_NAMES[+m - 1]} ${+d}, ${+y}`;
}

/**
 * Human relative time for TIMESTAMPS (full ISO datetimes — sync stamps,
 * peer last-seen). Not for calendar dates; those stay string-based above.
 *   "just now" · "4 minutes ago" · "an hour ago" · "yesterday" · "3 days ago"
 * Falls back to MM/DD/YYYY beyond a week, 'never' for missing values.
 */
export function timeAgo(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 2) return 'an hour ago';
  if (h < 24) return `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return formatDateMMDDYYYY(iso);
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
