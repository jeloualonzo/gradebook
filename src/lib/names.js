/**
 * Student name formatting — ONE definition for the whole app (gradebook,
 * student manager, groups, attendance, Excel/PDF exports).
 *
 * Format:  Last Name, First Name MI. Suffix
 * Examples: "Dela Cruz, Juan S. Jr." · "Garcia, Maria R. III" · "Santos, Pedro"
 *
 * The suffix is DISPLAY-ONLY: sorting everywhere is Last → First → Middle
 * (see the ORDER BY clauses in src/lib/queries) and never includes it.
 */
export function displayName(s) {
  if (!s) return '';
  const mi = s.middle_name ? ` ${String(s.middle_name).charAt(0)}.` : '';
  const suffix = s.suffix ? ` ${s.suffix}` : '';
  return `${s.last_name}, ${s.first_name}${mi}${suffix}`;
}

/** Lower-cased haystack for search boxes (includes the suffix on purpose). */
export function searchText(s) {
  return [s.last_name, s.first_name, s.middle_name, s.suffix]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
