'use client';
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Modal from './Modal';
import { parseStudentsWorkbook, studentFullNameKey } from '@/lib/excelImport';

/** Generate and download the import template (the four expected columns). */
function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['First Name', 'Middle Name', 'Last Name', 'Suffix'],
    ['Juan', 'Santos', 'Dela Cruz', 'Jr.'],
    ['Maria', 'Reyes', 'Garcia', ''],
  ]);
  ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'student-import-template.xlsx');
}

/**
 * Import students into a Student Group from an Excel file (.xlsx / .xls).
 *
 * Shows a preview with counts before anything is written. Students whose full
 * name already exists in the group (or appears twice in the file) are skipped
 * automatically — duplicates are never created within a group.
 */
export default function ExcelImportDialog({ open, onClose, groupId, existingStudents = [], onImported }) {
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState(null); // { students, blankRows }
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const reset = () => {
    setFileName('');
    setError('');
    setParsed(null);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    setError('');
    setParsed(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseStudentsWorkbook(buffer);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setParsed(result);
    } catch {
      setError('Could not read the file. Make sure it is a valid .xlsx or .xls Excel file.');
    }
  };

  // Preview math: how many will actually be imported vs skipped as duplicates
  // (against the group's current students AND within the file itself).
  const preview = (() => {
    if (!parsed) return null;
    const seen = new Set(existingStudents.map(studentFullNameKey));
    const toImport = [];
    let duplicates = 0;
    for (const s of parsed.students) {
      const key = studentFullNameKey(s);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      toImport.push(s);
    }
    return { toImport, duplicates, blankRows: parsed.blankRows, totalRows: parsed.students.length };
  })();

  const handleImport = async () => {
    if (!parsed || !preview || preview.toImport.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/students/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: parsed.students }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      onImported?.(result);
      handleClose();
    } catch (err) {
      setError(err.message);
      setImporting(false);
    }
  };

  const shown = preview ? preview.toImport.slice(0, 8) : [];

  return (
    <Modal open={open} onClose={handleClose} title="Import from Excel" width="max-w-lg">
      <div className="space-y-4">
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 leading-relaxed">
          The Excel file (<span className="font-medium">.xlsx</span> or <span className="font-medium">.xls</span>) must
          contain the columns{' '}
          <span className="font-medium text-gray-700">First Name, Middle Name, Last Name</span>
          {' '}— plus an optional <span className="font-medium text-gray-700">Suffix</span> column
          (Jr., Sr., II, III…). Column names are matched case-insensitively. Blank rows are
          ignored and duplicate students (same full name) are skipped automatically.
          <button
            type="button"
            onClick={downloadTemplate}
            className="block mt-1.5 text-blue-600 hover:text-blue-800 font-medium"
          >
            Download the Excel template
          </button>
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={handleFile}
            className="block w-full text-sm text-gray-600 file:mr-3 file:px-4 file:py-2 file:border-0 file:rounded-lg file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100 file:cursor-pointer cursor-pointer"
          />
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
            {error}
          </div>
        )}

        {preview && !error && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="px-2 py-1 bg-green-50 text-green-700 rounded-full font-medium">
                {preview.toImport.length} student{preview.toImport.length !== 1 ? 's' : ''} will be imported
              </span>
              {preview.duplicates > 0 && (
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-full font-medium">
                  {preview.duplicates} duplicate{preview.duplicates !== 1 ? 's' : ''} skipped
                </span>
              )}
              {preview.blankRows > 0 && (
                <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded-full">
                  {preview.blankRows} blank row{preview.blankRows !== 1 ? 's' : ''} ignored
                </span>
              )}
            </div>

            {preview.toImport.length > 0 ? (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">First Name</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Middle Name</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Last Name</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Suffix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 text-gray-800">{s.first_name}</td>
                        <td className="px-3 py-1.5 text-gray-500">{s.middle_name}</td>
                        <td className="px-3 py-1.5 text-gray-800">{s.last_name}</td>
                        <td className="px-3 py-1.5 text-gray-500">{s.suffix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.toImport.length > shown.length && (
                  <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50">
                    …and {preview.toImport.length - shown.length} more
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
                Nothing to import — every student in the file already exists in this group.
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!preview || preview.toImport.length === 0 || importing}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {importing
              ? 'Importing…'
              : preview && preview.toImport.length > 0
                ? `Import ${preview.toImport.length} Student${preview.toImport.length !== 1 ? 's' : ''}`
                : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
