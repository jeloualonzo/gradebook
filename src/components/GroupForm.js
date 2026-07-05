'use client';
import { useState } from 'react';

/** Create/edit form for a Student Group (name + optional description). */
export default function GroupForm({ initial = {}, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    description: initial.description || '',
  });

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Group Name</label>
        <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. BSIS 2A" required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description <span className="text-gray-400">(optional)</span></label>
        <textarea
          className={inputClass + ' resize-none'}
          rows={2}
          value={form.description}
          onChange={set('description')}
          placeholder="e.g. 2nd year BS Information Systems, Section A"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
