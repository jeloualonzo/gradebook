import * as XLSX from 'xlsx';

/**
 * Excel roster parsing for Student Groups.
 *
 * The uploaded file (.xlsx or .xls) must contain these three columns
 * (matched case-insensitively): First Name, Middle Name, Last Name.
 * A fourth column — Suffix (Jr., Sr., II, III …) — is OPTIONAL: files
 * without it keep importing exactly as before.
 * Blank rows are ignored, values are trimmed, capitalization is preserved.
 */

const REQUIRED_COLUMNS = ['first name', 'middle name', 'last name'];
const OPTIONAL_COLUMNS = ['suffix'];
const COLUMN_TITLES = {
  'first name': 'First Name',
  'middle name': 'Middle Name',
  'last name': 'Last Name',
  'suffix': 'Suffix',
};

const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Case-insensitive full-name identity used for duplicate detection —
 *  the suffix is part of the identity ("… Jr." ≠ the father). */
export function studentFullNameKey({ first_name = '', middle_name = '', last_name = '', suffix = '' }) {
  return [first_name, middle_name, last_name, suffix]
    .map(s => String(s || '').trim().toLowerCase())
    .join('|');
}

/**
 * Parse an Excel file (ArrayBuffer) into a student list.
 * Returns:
 *   { ok: true, students: [{first_name, middle_name, last_name}], blankRows, sheetName }
 *   { ok: false, error: string }
 */
export function parseStudentsWorkbook(arrayBuffer) {
  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: 'array' });
  } catch {
    return { ok: false, error: 'Could not read the file. Make sure it is a valid .xlsx or .xls Excel file.' };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'The Excel file contains no sheets.' };

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  // The header row is the first row with any non-blank cell.
  const headerIdx = rows.findIndex(r => (r || []).some(c => String(c ?? '').trim() !== ''));
  if (headerIdx === -1) return { ok: false, error: 'The Excel file is empty.' };

  const headerRow = (rows[headerIdx] || []).map(h => String(h ?? '').trim());
  const colIndex = {};
  const extras = [];
  headerRow.forEach((h, i) => {
    if (!h) return;
    const n = normalizeHeader(h);
    if (REQUIRED_COLUMNS.includes(n) || OPTIONAL_COLUMNS.includes(n)) {
      if (colIndex[n] === undefined) colIndex[n] = i;
      else extras.push(h); // duplicated column
    } else {
      extras.push(h);
    }
  });

  const missing = REQUIRED_COLUMNS.filter(c => colIndex[c] === undefined);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.map(c => COLUMN_TITLES[c]).join(', ')}. ` +
        'The file must contain the columns First Name, Middle Name, Last Name — plus an optional Suffix column.',
    };
  }
  if (extras.length > 0) {
    return {
      ok: false,
      error: `Unexpected column${extras.length > 1 ? 's' : ''}: ${extras.join(', ')}. ` +
        'The file may only contain First Name, Middle Name, Last Name, and an optional Suffix column.',
    };
  }

  const students = [];
  let blankRows = 0;
  const suffixIdx = colIndex['suffix']; // undefined when the column is absent
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const first_name = String(r[colIndex['first name']] ?? '').trim();
    const middle_name = String(r[colIndex['middle name']] ?? '').trim();
    const last_name = String(r[colIndex['last name']] ?? '').trim();
    const suffix = suffixIdx === undefined ? '' : String(r[suffixIdx] ?? '').trim();
    if (!first_name && !middle_name && !last_name && !suffix) {
      blankRows++;
      continue;
    }
    students.push({ first_name, middle_name, last_name, suffix });
  }

  return { ok: true, students, blankRows, sheetName };
}
