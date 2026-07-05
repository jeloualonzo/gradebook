'use client';
import { useState, useEffect } from 'react';
import Modal from './Modal';

/**
 * Import students into an EXISTING subject by copying them from a Student
 * Group. New students are appended to the current list; existing grades are
 * untouched. Optionally skips students whose full name (First + Middle +
 * Last) already exists in the subject.
 */
export default function ImportStudentsDialog({ open, onClose, subjectId, onImported }) {
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    (async () => {
      setError('');
      setLoadingGroups(true);
      try {
        const res = await fetch('/api/groups');
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setGroups(list);
        setGroupId(prev => prev || (list[0] ? String(list[0].id) : ''));
      } catch {
        setGroups([]);
      } finally {
        setLoadingGroups(false);
      }
    })();
  }, [open]);

  const selectedGroup = groups.find(g => String(g.id) === String(groupId)) || null;

  const handleImport = async () => {
    if (!groupId) return;
    setImporting(true);
    setError('');
    try {
      const res = await fetch(`/api/subjects/${subjectId}/import-students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, skipDuplicates }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      onImported?.(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import Students" width="max-w-sm">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-gray-700 mb-2">Import From</p>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" checked readOnly className="w-3.5 h-3.5 text-blue-600" />
            Student Group
          </label>
        </div>

        {loadingGroups ? (
          <p className="text-sm text-gray-400">Loading groups…</p>
        ) : groups.length === 0 ? (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
            No student groups yet. Create one on the <span className="font-medium">Student Groups</span> page first.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Select Group</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
              >
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({Number(g.student_count) || 0} student{(Number(g.student_count) || 0) !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={e => setSkipDuplicates(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600"
              />
              Skip students with the same full name
            </label>

            <p className="text-xs text-gray-400 leading-relaxed">
              Students are <span className="font-medium text-gray-500">copied</span> and appended to this
              subject&apos;s list. Existing grades are untouched, and later changes to the group won&apos;t
              affect this subject.
            </p>
          </>
        )}

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!groupId || importing || groups.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? 'Importing…' : selectedGroup ? `Import from ${selectedGroup.name}` : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
