'use client';
import { useEffect, useMemo } from 'react';
import { buildStudentFocus } from '@/lib/studentFocus';
import { formatGrade, formatNumber } from '@/lib/gradeCalculator';
import { displayName } from '@/lib/names';

const PERIOD_TEXT = { PRELIM: 'text-blue-700', MIDTERM: 'text-green-700', FINAL: 'text-purple-700' };

/**
 * Conference mode (ROADMAP Phase 3b): everything about ONE student, in a
 * right-side drawer so the grid stays visible while you talk. A reading
 * surface — no inputs, no focus trap; Esc or clicking outside closes it.
 * Live: it renders from the same scores map as the grid, so fixing a score
 * mid-conversation updates the panel.
 */
export default function StudentFocusPanel({ student, subject, periods, scores, rosterNo, onClose }) {
  const model = useMemo(
    () => buildStudentFocus({ student, subject, periods, scores }),
    [student, subject, periods, scores]
  );

  // Esc closes — registered directly (not useHotkey) so it can sit above the
  // grid's own Escape duties without joining the modal stack.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Invisible click-away layer — no dimming; the grid stays readable. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="gb-drawer fixed top-0 right-0 bottom-0 w-[380px] max-w-[92vw] bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">
              {rosterNo ? <span className="text-gray-400 mr-1.5">#{rosterNo}</span> : null}
              {displayName(student)}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Final grade <span className="font-bold text-blue-800">{formatGrade(model.finalGrade)}</span>
              {model.missingCount > 0 && (
                <span className="ml-2 text-amber-600 font-medium">{model.missingCount} missing</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded" title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {model.periods.map(p => (
            <section key={p.type}>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className={`text-xs font-bold tracking-wide ${PERIOD_TEXT[p.type] || 'text-gray-700'}`}>{p.type}</h3>
                <span className={`text-sm font-semibold ${PERIOD_TEXT[p.type] || 'text-gray-700'}`}>{formatGrade(p.grade)}</span>
              </div>
              <div className="space-y-2.5">
                {p.assessments.map(a => (
                  <div key={a.id}>
                    <div className="flex items-baseline justify-between text-xs text-gray-600">
                      <span className="font-medium text-gray-700">{a.name}</span>
                      <span className="text-gray-400">
                        {a.weight > 0 ? `${formatNumber(a.weight)}%` : ''}
                        {a.entries.length > 0 ? `${a.weight > 0 ? ' · ' : ''}${a.entered} of ${a.entries.length}` : ''}
                      </span>
                    </div>
                    {/* Workspace assessment (v1.9.0): one computed chip. */}
                    {a.workspace && (
                      <div className="mt-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] border ${
                            a.workspace.status === 'completed'
                              ? 'bg-white border-gray-200 text-gray-700'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}
                          title={a.workspace.status === 'completed'
                            ? `${formatNumber(a.workspace.earned)} of ${formatNumber(a.workspace.max)}`
                            : a.workspace.status === 'not_applicable' ? 'Completed in another period' : 'Expected — no score yet'}
                        >
                          {a.workspace.status === 'completed'
                            ? formatNumber(a.workspace.earned)
                            : a.workspace.status === 'not_applicable' ? 'N/A' : '—'}
                        </span>
                      </div>
                    )}
                    {a.entries.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {a.entries.map(e => (
                          <span
                            key={e.columnId}
                            title={`${e.dateLabel} · max ${formatNumber(e.max)}`}
                            className={`px-1.5 py-0.5 rounded text-[11px] border ${
                              e.missing
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : e.value === null
                                  ? 'bg-gray-50 border-gray-200 text-gray-300'
                                  : 'bg-white border-gray-200 text-gray-700'
                            }`}
                          >
                            {e.letter || (e.value !== null ? formatNumber(e.value) : '—')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          {model.missingCount > 0 && (
            <section className="border-t border-gray-100 pt-3">
              <h3 className="text-xs font-bold tracking-wide text-amber-700 mb-1.5">MISSING</h3>
              <ul className="text-xs text-gray-600 space-y-0.5">
                {model.missing.map((m, i) => (
                  <li key={i}>
                    {m.assessment}{m.date ? ` — ${m.date}` : ''} <span className="text-gray-400">({m.period})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
