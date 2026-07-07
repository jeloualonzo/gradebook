'use client';
import { useState } from 'react';
import { toCents } from '@/lib/gradeCalculator';

const SCHOOL_YEARS = (() => {
  const years = [];
  const now = new Date().getFullYear();
  for (let y = now - 2; y <= now + 3; y++) {
    years.push(`${y}-${y + 1}`);
  }
  return years;
})();

export default function SubjectForm({ initial = {}, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    subject_code: initial.subject_code || '',
    section: initial.section || '',
    school_year: initial.school_year || SCHOOL_YEARS[2],
    semester: initial.semester || '1st',
    prelim_weight: initial.prelim_weight ?? 30,
    midterm_weight: initial.midterm_weight ?? 30,
    final_weight: initial.final_weight ?? 40,
  });

  // Integer-cents math — no floating-point drift.
  const totalWeightCents = toCents(form.prelim_weight) + toCents(form.midterm_weight) + toCents(form.final_weight);
  // Derived directly from form state — no effect/state needed.
  const weightError = totalWeightCents !== 10000 ? 'Period weights must sum to 100%.' : '';

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (weightError) return;
    onSubmit(form);
  };

  const labelClass = 'block text-xs font-medium text-gray-700 mb-1';
  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <div className="w-28 shrink-0">
          <label className={labelClass}>Subject Code</label>
          <input className={inputClass} value={form.subject_code} onChange={set('subject_code')} placeholder="IT101" />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Subject Title</label>
          <input
            className={inputClass}
            value={form.name}
            onChange={set('name')}
            placeholder="e.g. Introduction to Computing"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Section</label>
          <input className={inputClass} value={form.section} onChange={set('section')} placeholder="e.g. BSCS-2A" required />
        </div>
        <div>
          <label className={labelClass}>Semester</label>
          <select className={inputClass} value={form.semester} onChange={set('semester')}>
            <option value="1st">1st Semester</option>
            <option value="2nd">2nd Semester</option>
            <option value="Summer">Summer</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>School Year</label>
        <select className={inputClass} value={form.school_year} onChange={set('school_year')}>
          {SCHOOL_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs font-medium text-gray-700 mb-3">
          Grading Period Weights
          <span className={`ml-2 font-semibold ${weightError ? 'text-red-500' : 'text-green-600'}`}>
            ({totalWeightCents / 100}%)
          </span>
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[['Prelim', 'prelim_weight'], ['Midterm', 'midterm_weight'], ['Final', 'final_weight']].map(([label, key]) => (
            <div key={key}>
              <label className={labelClass}>{label}</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className={inputClass + ' pr-6'}
                  value={form[key]}
                  onChange={set(key)}
                  required
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
              </div>
            </div>
          ))}
        </div>
        {weightError && <p className="text-xs text-red-500 mt-1.5">{weightError}</p>}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !!weightError}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
