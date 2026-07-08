'use client';
import { useState, useEffect } from 'react';
import Modal from './Modal';
import { displayName } from '@/lib/names';

/**
 * Add ONE student (from a subject) into an existing Student Group — keeps
 * groups naturally in sync when late enrollees are added straight into a
 * subject. Duplicates are skipped by the group's own full-name check.
 */
export default function AddToGroupDialog({ open, student, onClose, onDone }) {
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/groups');
        const d = await res.json();
        const list = Array.isArray(d) ? d : [];
        setGroups(list);
        setGroupId(prev => prev || (list[0] ? String(list[0].id) : ''));
      } catch {
        setGroups([]);
      }
    })();
  }, [open]);

  const add = async () => {
    if (!groupId || !student) return;
    setAdding(true);
    setError('');
    try {
      const res = await fetch(`/api/groups/${groupId}/students/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: [{
            last_name: student.last_name,
            first_name: student.first_name,
            middle_name: student.middle_name || '',
            suffix: student.suffix || '',
          }],
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not add to the group');
      const group = groups.find(g => String(g.id) === String(groupId));
      onDone?.(d.added > 0
        ? `${displayName(student)} added to “${group?.name || 'group'}”.`
        : `${displayName(student)} is already in “${group?.name || 'group'}”.`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add to Student Group" width="max-w-sm">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Add <span className="font-medium text-gray-700">{student ? displayName(student) : ''}</span> to
          an existing Student Group. The subject is not changed; duplicates are skipped automatically.
        </p>
        {groups.length === 0 ? (
          <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg p-3">
            No Student Groups yet — create one from the Student Groups page first.
          </p>
        ) : (
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
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
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
            onClick={add}
            disabled={adding || !groupId || groups.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add to Group'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
