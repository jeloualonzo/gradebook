'use client';
import { useState } from 'react';
import { HIGHLIGHT_RULES, defaultHighlightConfig, moveHighlightRule } from '@/lib/highlights';
import { loadHighlightConfig, saveHighlightConfig } from '@/lib/highlightsClient';

/**
 * Settings → Cell Coloring (v1.8.0) — Excel's conditional-formatting manager,
 * sized for a class record. Entirely registry-driven: a future rule added to
 * HIGHLIGHT_RULES appears here with zero UI changes. Rules are checked top
 * to bottom and the FIRST match colors the cell, so the ↑/↓ order is the
 * priority. Everything persists per device the moment it changes (coloring
 * is a viewing preference, never synced).
 */

const KIND_LABELS = {
  score: 'score cells',
  periodGrade: 'period grades',
  finalGrade: 'final grades',
};

// A representative value per rule so the preview chip shows a real match.
const PREVIEW_TEXT = {
  overMax: '105',
  missing: '',
  zero: '0',
  failedScore: '4',
  failedPeriodGrade: '72.5',
  failedFinalGrade: '74.2',
};

export default function HighlightSettingsPanel() {
  const [config, setConfig] = useState(() => loadHighlightConfig());
  const apply = (next) => {
    setConfig(next);
    saveHighlightConfig(next);
  };

  const patchRule = (id, patch) => {
    apply({ ...config, rules: { ...config.rules, [id]: { ...config.rules[id], ...patch } } });
  };
  const move = (id, delta) => apply(moveHighlightRule(config, id, delta));
  const restoreDefaults = () => apply(defaultHighlightConfig());

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <p className="text-xs text-gray-500">
            Rules are checked <span className="font-semibold text-gray-700">top to bottom</span> — the first match colors the cell.
            Use ↑ ↓ to set priority.
          </p>
          <button
            onClick={restoreDefaults}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
          >
            Restore defaults
          </button>
        </div>

        <ul>
          {config.order.map((id, idx) => {
            const reg = HIGHLIGHT_RULES.find(r => r.id === id);
            if (!reg) return null;
            const rule = config.rules[id];
            return (
              <li key={id} className={`flex items-center gap-3 px-5 py-2.5 border-b border-gray-50 last:border-0 ${rule.enabled ? '' : 'opacity-55'}`}>
                {/* Priority */}
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => move(id, -1)}
                    disabled={idx === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-25 leading-none p-0.5"
                    title="Higher priority"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(id, +1)}
                    disabled={idx === config.order.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-25 leading-none p-0.5"
                    title="Lower priority"
                  >
                    ▼
                  </button>
                </div>

                {/* Enable + name */}
                <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-blue-600 shrink-0"
                    checked={!!rule.enabled}
                    onChange={e => patchRule(id, { enabled: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-800 font-medium truncate">{reg.label}</span>
                    <span className="block text-[11px] text-gray-400 truncate" title={reg.description}>
                      {reg.description} <span className="text-gray-300">· {KIND_LABELS[reg.kind]}</span>
                    </span>
                  </span>
                </label>

                {/* Threshold (rules that have one) */}
                {reg.threshold && (
                  <label className="flex items-center gap-1.5 shrink-0 text-[11px] text-gray-500">
                    {reg.threshold.label}
                    <input
                      type="number"
                      min={reg.threshold.min}
                      max={reg.threshold.max}
                      value={rule.threshold}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v)) patchRule(id, { threshold: Math.min(reg.threshold.max, Math.max(reg.threshold.min, v)) });
                      }}
                      className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                )}

                {/* Colors — native pickers, the desktop answer */}
                <label className="flex items-center gap-1 shrink-0 text-[11px] text-gray-400" title="Cell background">
                  <input
                    type="color"
                    value={rule.bg}
                    onChange={e => patchRule(id, { bg: e.target.value })}
                    className="w-7 h-6 border border-gray-200 rounded cursor-pointer bg-white p-0.5"
                  />
                </label>
                <label className="flex items-center gap-1 shrink-0 text-[11px] text-gray-400" title="Text color">
                  <input
                    type="color"
                    value={rule.fg}
                    onChange={e => patchRule(id, { fg: e.target.value })}
                    className="w-7 h-6 border border-gray-200 rounded cursor-pointer bg-white p-0.5"
                  />
                </label>

                {/* Live preview: a fake cell showing a matching value */}
                <span
                  className="shrink-0 w-12 text-center text-xs py-1 border border-gray-200 rounded tabular-nums"
                  style={rule.enabled ? { backgroundColor: rule.bg, color: rule.fg } : { backgroundColor: '#ffffff', color: '#9ca3af' }}
                  title="Preview"
                >
                  {PREVIEW_TEXT[id] ?? '72'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-gray-400 px-1">
        Coloring is a viewing preference — it lives on this laptop only and never changes any grade.
        The Missing rule is the same switch as the View menu&apos;s missing-score highlight.
      </p>
    </div>
  );
}
