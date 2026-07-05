'use client';
import { useState } from 'react';

const DEFAULT_ASSESSMENTS = [
  { name: 'Attendance', is_exam: false, enabled: true },
  { name: 'Quiz', is_exam: false, enabled: true },
  { name: 'Oral', is_exam: false, enabled: false },
  { name: 'Activity', is_exam: false, enabled: false },
  { name: 'Assignment', is_exam: false, enabled: false },
  { name: 'Project', is_exam: false, enabled: false },
  { name: 'Exam', is_exam: true, enabled: true },
];

export function getDefaultPeriodConfig(periodType) {
  return {
    type: periodType,
    assessments: DEFAULT_ASSESSMENTS.map(a => ({
      ...a,
      // The grading period already indicates PRELIM/MIDTERM/FINAL, so the
      // exam is simply called "Exam" — no period prefix.
      name: a.name,
      weight_percent: 0,
    })),
  };
}

export default function WizardPeriodConfig({ periodType, config, onChange }) {
  const [newName, setNewName] = useState('');

  const toggleAssessment = (i) => {
    const updated = config.assessments.map((a, idx) =>
      idx === i ? { ...a, enabled: !a.enabled } : a
    );
    onChange({ ...config, assessments: updated });
  };

  const updateWeight = (i, value) => {
    const numValue = value === '' ? 0 : Math.round(parseFloat(value) * 100) / 100;
    const updated = config.assessments.map((a, idx) =>
      idx === i ? { ...a, weight_percent: numValue } : a
    );
    onChange({ ...config, assessments: updated });
  };

  const updateName = (i, value) => {
    const updated = config.assessments.map((a, idx) =>
      idx === i ? { ...a, name: value } : a
    );
    onChange({ ...config, assessments: updated });
  };

  const removeCustom = (i) => {
    onChange({ ...config, assessments: config.assessments.filter((_, idx) => idx !== i) });
  };

  const addCustom = () => {
    const name = newName.trim();
    if (!name) return;
    onChange({
      ...config,
      assessments: [...config.assessments, { name, is_exam: false, enabled: true, weight_percent: 0 }],
    });
    setNewName('');
  };

  const enabledAssessments = config.assessments.filter(a => a.enabled);
  const totalWeight = enabledAssessments.reduce((s, a) => s + (parseFloat(a.weight_percent) || 0), 0);
  const weightOk = Math.abs(totalWeight - 100) <= 0.01;

  const isCustom = (a) => !DEFAULT_ASSESSMENTS.some(d => d.name === a.name && d.is_exam === a.is_exam);

  const periodColors = {
    PRELIM: 'bg-blue-50 border-blue-200',
    MIDTERM: 'bg-green-50 border-green-200',
    FINAL: 'bg-orange-50 border-orange-200',
  };

  const periodTextColors = {
    PRELIM: 'text-blue-800',
    MIDTERM: 'text-green-800',
    FINAL: 'text-orange-800',
  };

  return (
    <div className={`border rounded-xl p-4 ${periodColors[periodType] || 'bg-gray-50 border-gray-200'}`}>
      <h3 className={`text-sm font-semibold mb-3 ${periodTextColors[periodType] || 'text-gray-800'}`}>{periodType}</h3>

      <div className="space-y-2">
        {config.assessments.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={() => toggleAssessment(i)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
              disabled={a.is_exam}
            />
            <input
              className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:text-gray-500"
              value={a.name}
              onChange={(e) => updateName(i, e.target.value)}
              disabled={!a.enabled || a.is_exam}
              title={a.is_exam ? 'The exam is always named "Exam" — the grading period already identifies it' : undefined}
            />
            {a.enabled && (
              <div className="relative w-20 shrink-0">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className="w-full text-sm px-2 py-1 pr-5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={a.weight_percent}
                  onChange={(e) => updateWeight(i, e.target.value)}
                  placeholder="0"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
              </div>
            )}
            {isCustom(a) && (
              <button
                type="button"
                onClick={() => removeCustom(i)}
                className="text-gray-300 hover:text-red-500 transition-colors shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <input
          className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
          placeholder="Add custom assessment…"
        />
        <button
          type="button"
          onClick={addCustom}
          className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
        >
          Add
        </button>
      </div>

      <div className={`mt-3 text-xs font-medium ${weightOk ? 'text-green-700' : 'text-amber-600'}`}>
        Enabled weights total: {totalWeight.toFixed(1)}% {!weightOk && '(must equal 100%)'}
      </div>
    </div>
  );
}
