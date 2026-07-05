'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import WizardPeriodConfig, { getDefaultPeriodConfig } from '@/components/WizardPeriodConfig';
import { toCents, centsToNumber } from '@/lib/gradeCalculator';

const SCHOOL_YEARS = (() => {
  const years = [];
  const now = new Date().getFullYear();
  for (let y = now - 2; y <= now + 3; y++) years.push(`${y}-${y + 1}`);
  return years;
})();

export default function NewSubjectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><span className="text-sm text-gray-400">Loading…</span></div>}>
      <NewSubjectContent />
    </Suspense>
  );
}

function NewSubjectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('id');

  const [step, setStep] = useState(subjectId ? 2 : 1);
  const [form, setForm] = useState({
    name: '',
    section: '',
    school_year: SCHOOL_YEARS[2],
    semester: '1st',
    prelim_weight: 30,
    midterm_weight: 30,
    final_weight: 40,
  });
  const [periods, setPeriods] = useState([
    getDefaultPeriodConfig('PRELIM'),
    getDefaultPeriodConfig('MIDTERM'),
    getDefaultPeriodConfig('FINAL'),
  ]);
  const [saving, setSaving] = useState(false);
  const [weightError, setWeightError] = useState('');
  const [createdId, setCreatedId] = useState(subjectId || null);

  // Student Source: start empty, or copy students from a Student Group.
  const [groups, setGroups] = useState([]);
  const [studentSource, setStudentSource] = useState('empty'); // 'empty' | 'group'
  const [groupId, setGroupId] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/groups');
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setGroups(list);
        setGroupId(prev => prev || (list[0] ? String(list[0].id) : ''));
      } catch {
        setGroups([]);
      }
    })();
  }, []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  // Integer-cents math — no floating-point drift.
  const totalPWCents = toCents(form.prelim_weight) + toCents(form.midterm_weight) + toCents(form.final_weight);
  const totalPW = centsToNumber(totalPWCents);
  const periodWeightOk = totalPWCents === 10000;

  const handleStep1 = async (e) => {
    e.preventDefault();
    if (!periodWeightOk) { setWeightError('Period weights must sum to 100%.'); return; }
    setSaving(true);
    const res = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const { id } = await res.json();
    // One-time copy of the selected group's students into the new subject.
    if (studentSource === 'group' && groupId) {
      await fetch(`/api/subjects/${id}/import-students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, skipDuplicates: false }),
      });
    }
    setCreatedId(id);
    setSaving(false);
    setStep(2);
  };

  const periodsValid = periods.every(p => {
    const enabled = p.assessments.filter(a => a.enabled);
    const totalCents = enabled.reduce((s, a) => s + toCents(a.weight_percent), 0);
    return totalCents === 10000 || enabled.length === 0;
  });

  const handleFinish = async () => {
    setSaving(true);
    const payload = periods.map(p => ({
      type: p.type,
      assessments: p.assessments
        .filter(a => a.enabled)
        // Send clean cents-normalized numbers (exactly what the user entered).
        .map(a => ({ name: a.name, is_exam: a.is_exam, weight_percent: centsToNumber(toCents(a.weight_percent)) })),
    }));

    await fetch(`/api/subjects/${createdId}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periods: payload }),
    });
    setSaving(false);
    router.push(`/subjects/${createdId}`);
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  const labelClass = 'block text-xs font-medium text-gray-700 mb-1';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-700 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1 className="text-base font-semibold text-gray-900">New Subject</h1>
          <p className="text-xs text-gray-500">Step {step} of 2</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                step >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
              }`}>{s}</div>
              <span className={`text-sm ${step >= s ? 'text-gray-800' : 'text-gray-400'}`}>
                {s === 1 ? 'Basic Info' : 'Configure Grading'}
              </span>
              {s < 2 && <div className={`w-8 h-0.5 ${step > s ? 'bg-blue-600' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={handleStep1} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <div>
              <label className={labelClass}>Subject Name</label>
              <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Introduction to Computing" required />
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
                <span className={`ml-2 font-semibold ${periodWeightOk ? 'text-green-600' : 'text-amber-600'}`}>
                  ({totalPW}%)
                </span>
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[['Prelim', 'prelim_weight'], ['Midterm', 'midterm_weight'], ['Final', 'final_weight']].map(([label, key]) => (
                  <div key={key}>
                    <label className={labelClass}>{label}</label>
                    <div className="relative">
                      <input type="number" min="0" max="100" step="0.01" className={inputClass + ' pr-6'}
                        value={form[key]} onChange={set(key)} required />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                    </div>
                  </div>
                ))}
              </div>
              {weightError && <p className="text-xs text-red-500 mt-1.5">{weightError}</p>}
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-medium text-gray-700 mb-3">Student Source</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                  <input
                    type="radio"
                    name="studentSource"
                    className="w-3.5 h-3.5 text-blue-600"
                    checked={studentSource === 'empty'}
                    onChange={() => setStudentSource('empty')}
                  />
                  Start with an empty student list
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer ${groups.length === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                  <input
                    type="radio"
                    name="studentSource"
                    className="w-3.5 h-3.5 text-blue-600"
                    checked={studentSource === 'group'}
                    disabled={groups.length === 0}
                    onChange={() => setStudentSource('group')}
                  />
                  Import from Student Group
                  {groups.length === 0 && <span className="text-xs text-gray-400">(no groups created yet)</span>}
                </label>
              </div>

              {studentSource === 'group' && groups.length > 0 && (
                <div className="mt-3">
                  <label className={labelClass}>Student Group</label>
                  <select className={inputClass} value={groupId} onChange={e => setGroupId(e.target.value)}>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({Number(g.student_count) || 0} student{(Number(g.student_count) || 0) !== 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Students are copied into this subject. Later changes to the group won&apos;t affect it.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={saving} className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Next →'}
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Configure assessments and weights for each grading period. Enabled assessment weights must total 100% per period.
            </p>
            {periods.map((period, i) => (
              <WizardPeriodConfig
                key={period.type}
                periodType={period.type}
                config={period}
                onChange={(updated) => setPeriods(prev => prev.map((p, idx) => idx === i ? updated : p))}
              />
            ))}
            <div className="flex justify-between items-center pt-4">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                ← Back
              </button>
              <button
                onClick={handleFinish}
                disabled={saving || !periodsValid}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Subject'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
