'use client';
import { useState } from 'react';

/**
 * Shared student name form (Last / Suffix / First / Middle) used by both
 * subject students (StudentManager) and Student Group students.
 */
export default function StudentForm({ initial = {}, onSubmit, onCancel, loading, groups = null }) {
  const [form, setForm] = useState({
    last_name: initial.last_name || '',
    first_name: initial.first_name || '',
    middle_name: initial.middle_name || '',
    suffix: initial.suffix || '',
  });
  // Optional: also add the new student to a Student Group (one operation
  // instead of two when a late enrollee arrives). Rendered only when the
  // caller supplies groups (i.e. when CREATING a subject student).
  const [alsoGroup, setAlsoGroup] = useState(false);
  const [groupId, setGroupId] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  const submit = (e) => {
    e.preventDefault();
    onSubmit(alsoGroup && groupId ? { ...form, add_to_group_id: groupId } : form);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">Last Name</label>
          <input className={inputClass} value={form.last_name} onChange={set('last_name')} required />
        </div>
        <div className="w-24">
          <label className="block text-xs font-medium text-gray-700 mb-1">Suffix</label>
          <input className={inputClass} value={form.suffix} onChange={set('suffix')} placeholder="Jr., III" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
        <input className={inputClass} value={form.first_name} onChange={set('first_name')} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Middle Name <span className="text-gray-400">(optional)</span></label>
        <input className={inputClass} value={form.middle_name} onChange={set('middle_name')} />
      </div>
      {Array.isArray(groups) && groups.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={alsoGroup} onChange={e => setAlsoGroup(e.target.checked)} />
            Also add this student to a Student Group
          </label>
          {alsoGroup && (
            <select
              className={inputClass}
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
            >
              <option value="">Select a Student Group…</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
