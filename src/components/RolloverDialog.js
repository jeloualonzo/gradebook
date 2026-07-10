'use client';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { nextTerm } from '@/lib/term';

/**
 * "Start new term from this subject" (ROADMAP Phase 3b).
 *
 * Carries the teaching STRUCTURE into a new term — periods, assessment
 * categories with weights, attendance scoring — and lets the teacher choose
 * the roster. Dated columns and scores never travel; the dialog says so, in
 * gradebook language, so twice a year this is thirty seconds instead of
 * twenty minutes of re-encoding.
 */
export default function RolloverDialog({ subject, onClose, onCreated }) {
  const proposed = nextTerm(subject.school_year, subject.semester);
  const [name, setName] = useState(subject.name);
  const [code, setCode] = useState(subject.subject_code || '');
  const [section, setSection] = useState(subject.section || '');
  const [schoolYear, setSchoolYear] = useState(proposed.school_year);
  const [semester, setSemester] = useState(proposed.semester);
  const [roster, setRoster] = useState('copy');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/groups');
        const d = await res.json();
        if (alive && res.ok) setGroups(Array.isArray(d) ? d : []);
      } catch { /* groups are optional here */ }
    })();
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    if (saving) return;
    setError(null);
    if (roster === 'group' && !groupId) { setError('Pick a Student Group for the roster.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/subjects/${subject.id}/rollover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, subject_code: code, section,
          school_year: schoolYear, semester,
          roster, group_id: roster === 'group' ? groupId : null,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.id) throw new Error(d.error || 'Could not create the new term');
      onCreated(d.id);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const input = 'w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <Modal open onClose={onClose} title={`Start a new term from ${subject.subject_code || subject.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>School year</span>
            <input data-autofocus className={input} value={schoolYear} onChange={e => setSchoolYear(e.target.value)} />
          </div>
          <div>
            <span className={label}>Semester</span>
            <select className={input} value={semester} onChange={e => setSemester(e.target.value)}>
              <option value="1st">1st Semester</option>
              <option value="2nd">2nd Semester</option>
              <option value="Summer">Summer</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <span className={label}>Code</span>
            <input className={input} value={code} onChange={e => setCode(e.target.value)} />
          </div>
          <div className="col-span-2">
            <span className={label}>Subject name</span>
            <input className={input} value={name} onChange={e => setName(e.target.value)} />
          </div>
        </div>
        <div>
          <span className={label}>Section</span>
          <input className={input} value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. BSIS 3A" />
        </div>
        <div>
          <span className={label}>Students</span>
          <div className="space-y-1.5 text-sm text-gray-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="roster" className="accent-blue-600" checked={roster === 'copy'} onChange={() => setRoster('copy')} />
              Copy this subject&rsquo;s students
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="roster" className="accent-blue-600" checked={roster === 'group'} onChange={() => setRoster('group')} />
              Import from a Student Group
            </label>
            {roster === 'group' && (
              <select className={`${input} ml-6 w-auto min-w-[220px]`} value={groupId} onChange={e => setGroupId(e.target.value)}>
                <option value="">Choose a group…</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="roster" className="accent-blue-600" checked={roster === 'empty'} onChange={() => setRoster('empty')} />
              Start with no students
            </label>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Grading periods, assessment categories, weights, and attendance scoring carry over.
          Date columns and scores stay with the old term.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !name.trim() || !schoolYear.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create new term'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
