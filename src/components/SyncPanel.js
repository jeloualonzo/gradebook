'use client';
import { useState, useEffect, useCallback } from 'react';

const timeAgo = (iso) => {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

/**
 * Sync settings + status panel (rendered inside Settings → Synchronization).
 * Offline-first: everything here is optional — the gradebook works
 * identically whether or not a sync folder is configured.
 */
export default function SyncPanel({ onSynced }) {
  const [status, setStatus] = useState(null);
  const [folder, setFolder] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null); // { text, kind: 'ok' | 'error' }
  const [conflicts, setConflicts] = useState([]);
  const [showConflicts, setShowConflicts] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync');
      const d = await res.json();
      if (res.ok) {
        setStatus(d);
        setFolder(d.sync_folder || '');
      }
      const cRes = await fetch('/api/sync/conflicts');
      const c = await cRes.json();
      if (cRes.ok) setConflicts(c.conflicts || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    (async () => { await loadStatus(); })();
  }, [loadStatus]);

  const saveFolder = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_folder: folder }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save the folder');
      setStatus(d);
      setMessage({ text: folder.trim() ? 'Sync folder saved.' : 'Sync turned off.', kind: 'ok' });
    } catch (err) {
      setMessage({ text: err.message, kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const pickFolder = async () => {
    try {
      const picked = await window.gradebookDesktop?.pickFolder?.();
      if (picked) setFolder(picked);
    } catch {
      /* dialog cancelled */
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Sync failed');
      const merged = (d.imported || []).filter(r => r.status === 'merged');
      const applied = merged.reduce((s, r) => s + (r.applied || 0), 0);
      const newConflicts = merged.reduce((s, r) => s + (r.conflicts_logged || 0), 0);
      const peersSeen = (d.imported || []).filter(r => ['merged', 'up-to-date'].includes(r.status)).length;
      const problems = (d.imported || []).filter(r => !['merged', 'up-to-date'].includes(r.status));
      let text = applied > 0
        ? `Synced — ${applied} change${applied !== 1 ? 's' : ''} received.`
        : peersSeen > 0
          ? 'Synced — already up to date.'
          : 'Snapshot exported. Waiting for the other laptop to sync.';
      if (newConflicts > 0) {
        text += ` ${newConflicts} conflicting edit${newConflicts !== 1 ? 's' : ''} resolved (newest kept) — see the list below.`;
        setShowConflicts(true);
      }
      if (problems.length) text += ` (${problems.map(p => p.error ? `${p.status}: ${p.error}` : p.status).join(', ')})`;
      setMessage({ text, kind: newConflicts > 0 ? 'warn' : 'ok' });
      await loadStatus();
      if (applied > 0) onSynced?.();
    } catch (err) {
      setMessage({ text: err.message, kind: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-4">
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 leading-relaxed">
          Point both laptops at the <span className="font-medium text-gray-700">same shared folder</span>
          {' '}(Google Drive, Dropbox, OneDrive, or a USB stick). Each laptop drops a snapshot file there and
          picks up the other&apos;s. Works offline — syncing simply happens whenever the folder is reachable.
          <span className="block mt-1 text-amber-700">Use a dedicated folder — never the app&apos;s own data folder.</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Shared sync folder</label>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="e.g. C:\Users\you\Google Drive\GradebookSync"
              value={folder}
              onChange={e => setFolder(e.target.value)}
            />
            {typeof window !== 'undefined' && window.gradebookDesktop?.pickFolder && (
              <button
                type="button"
                onClick={pickFolder}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap"
              >
                Browse…
              </button>
            )}
            <button
              type="button"
              onClick={saveFolder}
              disabled={saving}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {status?.folder_problem && (
            <p className="text-[11px] text-red-600 mt-1">{status.folder_problem}</p>
          )}
        </div>

        {status && (
          <div className="text-xs text-gray-600 space-y-1.5">
            <div>
              This laptop: <span className="font-medium text-gray-800">{status.device_label || 'unnamed'}</span>
              {status.last_export_at && <span className="text-gray-400"> · snapshot exported {timeAgo(status.last_export_at)}</span>}
            </div>
            {status.peers.length === 0 ? (
              <div className="text-gray-400">No other laptop seen yet — after saving the folder, press Sync now on both laptops.</div>
            ) : (
              status.peers.map(p => (
                <div key={p.device_id}>
                  <span className="font-medium text-gray-800">{p.label || 'Other laptop'}</span>
                  <span className="text-gray-400"> · last synced {timeAgo(p.last_sync_at)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Clock sanity: newest-wins needs both clocks to be roughly right. */}
        {status?.peers?.some(p => p.clock_skew_minutes) && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {status.peers.filter(p => p.clock_skew_minutes).map(p => (
              <div key={p.device_id}>
                ⚠️ <span className="font-medium">{p.label || 'The other laptop'}</span>&apos;s clock looks
                about {p.clock_skew_minutes} min ahead. &quot;Newest edit wins&quot; can pick the wrong
                version until its Windows clock is fixed (Settings → Time &amp; language → Sync now).
              </div>
            ))}
          </div>
        )}

        {message && (
          <div className={`text-xs rounded-lg p-3 border ${
            message.kind === 'ok' ? 'text-green-700 bg-green-50 border-green-100'
            : message.kind === 'warn' ? 'text-amber-800 bg-amber-50 border-amber-200'
            : 'text-red-600 bg-red-50 border-red-100'}`}
          >
            {message.text}
          </div>
        )}

        {/* Conflict audit: what newest-wins replaced on THIS laptop. */}
        {conflicts.length > 0 && (
          <div className="text-xs border border-gray-200 rounded-lg">
            <button
              type="button"
              onClick={() => setShowConflicts(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              <span className="font-medium">Resolved conflicts on this laptop ({conflicts.length})</span>
              <span className="text-gray-400">{showConflicts ? '▴' : '▾'}</span>
            </button>
            {showConflicts && (
              <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-48 overflow-y-auto">
                {conflicts.map(c => (
                  <div key={c.id} className="px-3 py-2">
                    <div className="font-medium text-gray-800">{c.label}</div>
                    <div className="text-gray-600">
                      kept <span className="font-semibold text-green-700">{c.kept}</span>
                      <span className="text-gray-400"> ({c.kept_from}, {timeAgo(c.kept_at)})</span>
                      {' · '}replaced <span className="font-semibold text-red-600">{c.discarded}</span>
                      <span className="text-gray-400"> ({c.discarded_from}, {timeAgo(c.discarded_at)})</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing || !status?.sync_folder}
            title={!status?.sync_folder ? 'Save a sync folder first' : undefined}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
    </div>
  );
}
