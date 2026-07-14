'use client';
import { useState, useEffect } from 'react';
import Modal from './Modal';

/**
 * Remove an imported Student Group (v1.7.0). Students carry no origin link
 * (an import is a copy, by design), so removal matches the roster against
 * the group's CURRENT members by full-name identity — the same rule
 * move-column uses to carry scores between subjects. A dry run previews
 * exactly how many students match before anything is touched; removal
 * tombstones them (with their scores) through the normal delete path.
 */
export default function RemoveGroupDialog({ subjectId, onClose, onRemoved }) {
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [preview, setPreview] = useState(null); // { matched, roster }
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/groups');
        const d = await res.json();
        if (alive && res.ok) setGroups(Array.isArray(d) ? d : []);
      } catch { /* non-fatal */ }
    })();
    return () => { alive = false; };
  }, []);

  // Group changed → reset the preview (render-time adjustment, house pattern).
  const [prevGroupId, setPrevGroupId] = useState(groupId);
  if (prevGroupId !== groupId) {
    setPrevGroupId(groupId);
    setPreview(null);
    setError(null);
  }

  // Dry-run whenever the group changes: the count IS the confirmation info.
  useEffect(() => {
    if (!groupId) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/subjects/${subjectId}/remove-group-students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId, dry_run: true }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Could not check the group');
        if (alive) setPreview(d);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [groupId, subjectId]);

  const remove = async () => {
    if (working || !groupId || !preview?.matched) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/remove-group-students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, dry_run: false }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not remove the students');
      onRemoved(d.removed);
    } catch (err) {
      setError(err.message);
      setWorking(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Remove an imported group" width="max-w-sm">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Removes every student in this subject whose name matches a member of the
          chosen Student Group. Their scores are removed with them.
        </p>
        <select
          data-autofocus
          value={groupId}
          onChange={e => setGroupId(e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Choose a group…</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {preview && (
          <p className={`text-xs ${preview.matched > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
            {preview.matched > 0
              ? `${preview.matched} of this subject's ${preview.roster} students match this group.`
              : 'No students in this subject match that group.'}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={remove}
            disabled={working || !preview?.matched}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {working ? 'Removing…' : `Remove ${preview?.matched || ''} student${preview?.matched === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
