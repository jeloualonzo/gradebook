'use client';
import { useState, useEffect, useCallback } from 'react';
import Toast from './Toast';

const timeAgo = (iso) => {
  if (!iso) return 'unknown time';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

/**
 * Settings → Sync Conflicts: review what newest-wins decided, restore the
 * other version when the automatic decision was wrong.
 *
 * - Restore Previous writes the discarded value back as an ORDINARY new
 *   edit — it syncs normally and wins on the other laptop too.
 * - Mark as Reviewed just clears the badge; the entry stays in the history
 *   below (both values remain visible either way).
 */
export default function ConflictReviewPanel({ onChanged }) {
  const [conflicts, setConflicts] = useState(null); // null = loading
  const [busyId, setBusyId] = useState(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'success') => setToast({ message, type, key: Date.now() }), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/conflicts?limit=200');
      const d = await res.json();
      if (res.ok) setConflicts(d.conflicts || []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  const restore = async (c) => {
    setBusyId(c.id);
    try {
      const res = await fetch('/api/sync/conflicts/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not restore the value');
      showToast(`Restored ${d.restored} — it will sync to the other laptop.`);
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const markReviewed = async (ids, all = false) => {
    setBusyId(all ? 'all' : ids[0]);
    try {
      const res = await fetch('/api/sync/conflicts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all ? { all: true } : { ids }),
      });
      if (!res.ok) throw new Error('Could not update');
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (conflicts === null) {
    return <div className="text-center py-16 text-sm text-gray-400">Loading…</div>;
  }

  const unreviewed = conflicts.filter(c => !c.reviewed_at);
  const reviewed = conflicts.filter(c => c.reviewed_at);

  const conflictCard = (c, isReviewed) => (
    <div key={c.id} className={`px-4 py-3 ${isReviewed ? 'opacity-70' : ''}`}>
      <div className="text-sm font-medium text-gray-900">{c.label}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
        <div className="bg-green-50 border border-green-100 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-green-700 font-semibold">Kept (current)</div>
          <div className="text-gray-900 font-semibold mt-0.5">{c.kept}</div>
          <div className="text-gray-500 mt-0.5">{c.kept_from} · {timeAgo(c.kept_at)}</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Replaced</div>
          <div className="text-gray-900 font-semibold mt-0.5">{c.discarded}</div>
          <div className="text-gray-500 mt-0.5">{c.discarded_from} · {timeAgo(c.discarded_at)}</div>
        </div>
      </div>
      {!isReviewed && (
        <div className="flex items-center gap-2 mt-2.5">
          <button
            onClick={() => restore(c)}
            disabled={busyId === c.id || !c.restorable}
            title={c.restorable ? `Bring back "${c.discarded}" — becomes a new edit and syncs normally` : 'The row this conflict belonged to no longer exists'}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busyId === c.id ? 'Working…' : `Restore Previous (${c.discarded})`}
          </button>
          <button
            onClick={() => markReviewed([c.id])}
            disabled={busyId === c.id}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Keep Current — Mark as Reviewed
          </button>
        </div>
      )}
      {isReviewed && (
        <div className="text-[11px] text-gray-400 mt-1.5">Reviewed {timeAgo(c.reviewed_at)}</div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 leading-relaxed">
        When both laptops edit the <span className="font-medium text-gray-700">same thing</span> before
        syncing, the newest edit is kept automatically and the other version is saved here — nothing is
        lost. <span className="font-medium text-gray-700">Restore Previous</span> brings the replaced value
        back as a normal edit that syncs to the other laptop.
      </div>

      {unreviewed.length === 0 ? (
        <div className="text-center py-10 bg-white border border-gray-200 rounded-lg">
          <p className="text-sm text-gray-500">No conflicts to review</p>
          <p className="text-xs text-gray-400 mt-1">Every sync has merged cleanly.</p>
        </div>
      ) : (
        <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-900">
              {unreviewed.length} conflict{unreviewed.length !== 1 ? 's' : ''} to review
            </span>
            <button
              onClick={() => markReviewed([], true)}
              disabled={busyId === 'all'}
              className="text-xs font-medium text-amber-800 hover:text-amber-950 disabled:opacity-40"
            >
              {busyId === 'all' ? 'Working…' : 'Mark all as reviewed'}
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {unreviewed.map(c => conflictCard(c, false))}
          </div>
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowReviewed(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <span>Previously reviewed ({reviewed.length})</span>
            <span className="text-gray-400">{showReviewed ? '▴' : '▾'}</span>
          </button>
          {showReviewed && (
            <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {reviewed.map(c => conflictCard(c, true))}
            </div>
          )}
        </div>
      )}

      {toast && <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
