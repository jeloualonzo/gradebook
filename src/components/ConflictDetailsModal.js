'use client';
import { useState, useEffect } from 'react';
import Modal from './Modal';

const fmtWhen = (iso) => {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown time';
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/**
 * Conflict details, in the gradebook's own language.
 *
 * Context (subject · section · period · assessment · date · student), which
 * laptop edited what and when, and a VISUAL Previous/Current comparison:
 * a miniature gradebook for scores (conflicted row highlighted, roster
 * neighbors for recognition), a field table for everything else.
 * The details payload is built server-side (GET /api/sync/conflicts/:id).
 */
export default function ConflictDetailsModal({ conflict, open, onClose, onRestore, onMarkReviewed, busy }) {
  const [details, setDetails] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const conflictId = conflict?.id;

  // A different conflict → back to the loading state. Render-time adjustment
  // per the React docs (not an effect).
  const [loadedFor, setLoadedFor] = useState(conflictId);
  if (loadedFor !== conflictId) {
    setLoadedFor(conflictId);
    setDetails(null);
    setError(null);
  }

  useEffect(() => {
    if (!open || !conflictId) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/sync/conflicts/${conflictId}`);
        const d = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(d.error || 'Could not load the details');
        setDetails(d);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [open, conflictId]);

  const d = details;
  const unreviewed = d && !d.reviewed_at;

  return (
    <Modal open={open} onClose={onClose} title="Conflict Details" width="max-w-2xl">
      {error && <p className="text-sm text-red-600 py-6 text-center">{error}</p>}
      {!error && !d && <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>}
      {d && (
        <div className="space-y-4">
          {/* Where this happened — the gradebook context. */}
          {d.context.length > 0 && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5">
              {d.context.map(row => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs min-w-0">
                  <span className="text-gray-500 shrink-0">{row.label}</span>
                  <span className="text-gray-900 font-medium text-right truncate" title={row.value}>{row.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Who edited what, when. */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-green-700 font-semibold">Kept — current</div>
              <div className="text-base font-bold text-gray-900 mt-0.5 break-words">{d.kept}</div>
              <div className="text-[11px] text-gray-500 mt-1">{d.kept_from}</div>
              <div className="text-[11px] text-gray-400">{fmtWhen(d.kept_at)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Replaced</div>
              <div className="text-base font-bold text-gray-700 mt-0.5 break-words">{d.discarded}</div>
              <div className="text-[11px] text-gray-500 mt-1">{d.discarded_from}</div>
              <div className="text-[11px] text-gray-400">{fmtWhen(d.discarded_at)}</div>
            </div>
          </div>

          {/* Visual comparison. */}
          {d.comparison?.type === 'score-grid' && (
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1.5">{d.comparison.header}</div>
              <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 border-b border-gray-200">
                    <th className="text-left px-3 py-2 font-medium">Student</th>
                    <th className="text-center px-3 py-2 font-medium w-32">
                      Previous
                      <span className="block text-[10px] font-normal text-gray-400">{d.discarded_from}</span>
                    </th>
                    <th className="text-center px-3 py-2 font-medium w-32">
                      Current
                      <span className="block text-[10px] font-normal text-gray-400">{d.kept_from}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.comparison.students.map((s, i) => (
                    <tr key={i} className={`border-b border-gray-100 last:border-0 ${s.conflicted ? 'bg-amber-50' : ''}`}>
                      <td className={`px-3 py-1.5 ${s.conflicted ? 'font-semibold text-amber-900' : 'text-gray-600'}`}>
                        {s.conflicted && <span className="text-amber-500 mr-1">▸</span>}{s.name}
                      </td>
                      <td className={`px-3 py-1.5 text-center tabular-nums ${s.conflicted ? 'font-bold text-amber-900' : 'text-gray-400'}`}>{s.before}</td>
                      <td className={`px-3 py-1.5 text-center tabular-nums ${s.conflicted ? 'font-bold text-green-700' : 'text-gray-400'}`}>{s.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Neighboring students are shown with their current values for recognition — only the highlighted row was in conflict.
              </p>
            </div>
          )}

          {d.comparison?.type === 'fields' && (
            <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-50 text-[11px] text-gray-500 border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium">Field</th>
                  <th className="text-left px-3 py-2 font-medium w-40">
                    Previous
                    <span className="block text-[10px] font-normal text-gray-400">{d.discarded_from}</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium w-40">
                    Current
                    <span className="block text-[10px] font-normal text-gray-400">{d.kept_from}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.comparison.fields.map(f => (
                  <tr key={f.key} className={`border-b border-gray-100 last:border-0 ${f.changed ? 'bg-amber-50' : ''}`}>
                    <td className={`px-3 py-1.5 ${f.changed ? 'font-semibold text-amber-900' : 'text-gray-500'}`}>{f.label}</td>
                    <td className={`px-3 py-1.5 break-words ${f.changed ? 'font-semibold text-amber-900' : 'text-gray-400'}`}>{f.before}</td>
                    <td className={`px-3 py-1.5 break-words ${f.changed ? 'font-semibold text-green-700' : 'text-gray-400'}`}>{f.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {d.comparison?.superseded && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Heads up: this item has been edited again since the conflict was resolved — the Current column shows today&apos;s value.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {unreviewed && (
              <>
                <button
                  onClick={() => onRestore(conflict, d)}
                  disabled={busy || !d.restorable}
                  title={d.restorable ? undefined : 'The row this conflict belonged to no longer exists'}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40"
                >
                  Restore Previous…
                </button>
                <button
                  onClick={() => onMarkReviewed(conflict)}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Keep Current — Mark as Reviewed
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
