'use client';
import { useState } from 'react';
import Modal from './Modal';
import { WORKSPACE_TEMPLATES, AGG_METHODS } from '@/lib/workspace';

/**
 * Create a Workspace Assessment (v1.9.0) — template-first: teachers pick
 * "Oral Participation" or "Reporting", not an abstraction. Each template
 * PROVIDES defaults (span, computation, target); everything except the span
 * stays editable here and later in the workspace (span is immutable after
 * creation — changing it would silently reshuffle where existing scores
 * count).
 */
export default function WorkspaceAssessmentDialog({ periodId, periodType, onClose, onHistoryPush, onRefresh, onNotify }) {
  const [templateId, setTemplateId] = useState('oral');
  const template = WORKSPACE_TEMPLATES.find(t => t.id === templateId);
  const [name, setName] = useState(template.name === 'Custom workspace' ? '' : template.name);
  const [weight, setWeight] = useState('');
  const [method, setMethod] = useState(template.agg_method);
  const [target, setTarget] = useState(template.suggestedMax ?? '');
  const [saving, setSaving] = useState(false);

  const pickTemplate = (id) => {
    const t = WORKSPACE_TEMPLATES.find(x => x.id === id);
    setTemplateId(id);
    setName(t.id === 'custom' ? '' : t.name);
    setMethod(t.agg_method);
    setTarget(t.suggestedMax ?? '');
  };

  const span = template.span;
  const methodInfo = AGG_METHODS.find(m => m.id === method);
  // Term-span: the target input doubles as the per-period max score.
  const needsTarget = span === 'term' || methodInfo?.needsMax || method === 'average';
  const canSave = name.trim().length > 0 && (!methodInfo?.needsMax || parseFloat(target) > 0) && (span !== 'term' || parseFloat(target) > 0);

  const create = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const body = {
      name: name.trim(),
      is_exam: 0,
      weight_percent: parseFloat(weight) || 0,
      behavior: 'workspace',
      span,
      agg_method: span === 'term' ? 'sum' : method,
      agg_max: span === 'term' ? null : (parseFloat(target) > 0 ? parseFloat(target) : null),
      initial_max: span === 'term' ? (parseFloat(target) > 0 ? parseFloat(target) : 100) : null,
    };
    try {
      const res = await fetch(`/api/periods/${periodId}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.id) throw new Error(json?.error || 'Could not create the workspace.');
      onRefresh?.();
      if (onHistoryPush) {
        let currentId = json.id;
        onHistoryPush({
          label: `add workspace "${body.name}"`,
          undo: async () => {
            await fetch(`/api/assessments/${currentId}`, { method: 'DELETE' });
            onRefresh?.();
          },
          redo: async () => {
            const r = await fetch(`/api/periods/${periodId}/assessments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const j = await r.json().catch(() => ({}));
            if (j?.id) currentId = j.id;
            onRefresh?.();
          },
        });
      }
      onNotify?.(`${body.name} created — click its column to open the workspace`);
      onClose();
    } catch (err) {
      onNotify?.(err.message, 'error');
      setSaving(false);
    }
  };

  const row = 'flex items-center justify-between gap-3 py-1.5';
  const label = 'text-xs text-gray-600';

  return (
    <Modal open onClose={onClose} title="Add Workspace Assessment" width="max-w-md">
      <p className="text-xs text-gray-500 mb-3">
        One computed column in the gradebook — the detailed records live in a dedicated workspace.
      </p>

      <div className="space-y-1.5 mb-3">
        {WORKSPACE_TEMPLATES.map(t => (
          <label
            key={t.id}
            className={`flex items-start gap-2.5 border rounded-lg px-3 py-2 cursor-pointer ${templateId === t.id ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 hover:bg-gray-50'}`}
          >
            <input
              type="radio"
              name="ws-template"
              className="mt-0.5 accent-blue-600"
              checked={templateId === t.id}
              onChange={() => pickTemplate(t.id)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-800">
                {t.name}
                <span className="ml-1.5 text-[10px] font-normal text-gray-400">
                  {t.span === 'term' ? 'whole term' : 'this grading period'}
                </span>
              </span>
              <span className="block text-[11px] text-gray-500">{t.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className={row}>
        <span className={label}>Name</span>
        <input
          data-autofocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && create()}
          placeholder="e.g. Oral Participation"
          className="w-52 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className={row}>
        <span className={label}>Weight % <span className="text-gray-400">(in {periodType || 'each period'})</span></span>
        <input
          type="number"
          min="0"
          max="100"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          placeholder="0"
          className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {span !== 'term' && (
        <div className={row}>
          <span className={label}>Computation</span>
          <select
            value={method}
            onChange={e => setMethod(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AGG_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      )}
      {span !== 'term' && methodInfo?.hint && (
        <p className="text-[11px] text-gray-400 text-right -mt-0.5 mb-1">{methodInfo.hint}</p>
      )}
      {needsTarget && (
        <div className={row}>
          <span className={label}>{span === 'term' ? 'Max score' : 'Target total'}</span>
          <input
            type="number"
            min="1"
            value={target}
            onChange={e => setTarget(e.target.value)}
            className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={create}
          disabled={!canSave || saving}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Creating…' : 'Create Workspace'}
        </button>
      </div>
    </Modal>
  );
}
