'use client';
import { useState } from 'react';

/**
 * Shared student name form (Last / First / Middle) used by both subject
 * students (StudentManager) and Student Group students.
 */
export default function StudentForm({ initial = {}, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({
    last_name: initial.last_name || '',
    first_name: initial.first_name || '',
    middle_name: initial.middle_name || '',
  });

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Last Name</label>
        <input className={inputClass} value={form.last_name} onChange={set('last_name')} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
        <input className={inputClass} value={form.first_name} onChange={set('first_name')} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Middle Name <span className="text-gray-400">(optional)</span></label>
        <input className={inputClass} value={form.middle_name} onChange={set('middle_name')} />
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
