'use client';
import { useState, useEffect, useCallback } from 'react';
import SubjectCard from '@/components/SubjectCard';
import Modal from '@/components/Modal';
import SubjectForm from '@/components/SubjectForm';
import SyncDialog from '@/components/SyncDialog';
import Toast from '@/components/Toast';
import Link from 'next/link';

export default function HomePage() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  // First-run: this installation has no friendly name yet ("Jelou's laptop").
  const [needsDeviceName, setNeedsDeviceName] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [savingDevice, setSavingDevice] = useState(false);
  // Sync + ownership: this device's id and the known peers (for badges).
  const [syncInfo, setSyncInfo] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('all'); // 'all' | 'mine'

  const showToast = useCallback(
    (message, type = 'success') => setToast({ message, type, key: Date.now() }),
    []
  );

  const fetchSubjects = useCallback(async () => {
    try {
      const res = await fetch('/api/subjects');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch subjects');
      }
      setSubjects(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, 'error');
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    (async () => { await fetchSubjects(); })();
  }, [fetchSubjects]);

  const loadSyncInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/sync');
      const d = await res.json();
      if (res.ok) {
        setSyncInfo(d);
        // One question, once ever: what should this laptop be called?
        if (!d.device_label) setNeedsDeviceName(true);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    (async () => { await loadSyncInfo(); })();
  }, [loadSyncInfo]);

  const handleSaveDeviceName = async (e) => {
    e.preventDefault();
    const name = deviceName.trim();
    if (!name) return;
    setSavingDevice(true);
    try {
      const res = await fetch('/api/device', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_label: name }),
      });
      if (!res.ok) throw new Error('Could not save the name');
      setNeedsDeviceName(false);
      showToast(`This laptop is now "${name}"`);
      loadSyncInfo();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingDevice(false);
    }
  };

  const handleEdit = async (form) => {
    setSaving(true);
    await fetch(`/api/subjects/${editTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setEditTarget(null);
    showToast('Subject updated');
    fetchSubjects();
  };

  const handleDelete = async (id) => {
    await fetch(`/api/subjects/${id}`, { method: 'DELETE' });
    showToast('Subject deleted');
    fetchSubjects();
  };

  const handleDuplicate = async (id) => {
    const res = await fetch(`/api/subjects/${id}/duplicate`, { method: 'POST' });
    const { id: newId } = await res.json();
    showToast('Subject duplicated');
    fetchSubjects();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Faculty Gradebook</h1>
          <p className="text-xs text-gray-500 mt-0.5">Manage subjects and grades</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSyncOpen(true)}
            title="Sync with your other laptop"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            Sync
          </button>
          <Link
            href="/groups"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            Student Groups
          </Link>
          <Link
            href="/recycle-bin"
            title="Recently deleted subjects and groups"
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </Link>
          <Link
            href="/subjects/new"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Subject
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
        ) : subjects.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
              </svg>
            </div>
            <h2 className="text-base font-medium text-gray-700 mb-1">No subjects yet</h2>
            <p className="text-sm text-gray-400 mb-6">Create your first subject to start managing grades.</p>
            <Link
              href="/subjects/new"
              className="inline-block px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Create Subject
            </Link>
          </div>
        ) : (
          <>
            {(() => {
              const myId = syncInfo?.device_id;
              const peerLabels = Object.fromEntries((syncInfo?.peers || []).map(p => [p.device_id, p.label]));
              const ownerBadge = (s) =>
                myId && s.owner_device_id && s.owner_device_id !== myId
                  ? (peerLabels[s.owner_device_id] || 'Other laptop')
                  : null;
              const hasForeign = subjects.some(s => ownerBadge(s));
              const shown = ownerFilter === 'mine' && myId
                ? subjects.filter(s => !ownerBadge(s))
                : subjects;
              return (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <p className="text-sm text-gray-500">{shown.length} subject{shown.length !== 1 ? 's' : ''}</p>
                    {hasForeign && (
                      <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-medium">
                        {[['all', 'All'], ['mine', 'Mine']].map(([val, label]) => (
                          <button
                            key={val}
                            onClick={() => setOwnerFilter(val)}
                            className={`px-3 py-1 rounded-md transition-colors ${ownerFilter === val ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {shown.map(s => (
                      <SubjectCard
                        key={s.id}
                        subject={s}
                        ownerBadge={ownerBadge(s)}
                        onEdit={() => setEditTarget(s)}
                        onDelete={() => handleDelete(s.id)}
                        onDuplicate={() => handleDuplicate(s.id)}
                      />
                    ))}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </main>

      <Modal
        open={needsDeviceName}
        onClose={() => setNeedsDeviceName(false)}
        title="Name this laptop"
        width="max-w-sm"
      >
        <form onSubmit={handleSaveDeviceName} className="space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Give this installation a friendly name (e.g. <span className="font-medium text-gray-700">Jelou&apos;s laptop</span>).
            It identifies which laptop created each subject — it&apos;s not an account and there&apos;s nothing to log into.
          </p>
          <input
            autoFocus
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Jelou's laptop"
            value={deviceName}
            onChange={e => setDeviceName(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setNeedsDeviceName(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Later
            </button>
            <button
              type="submit"
              disabled={savingDevice || !deviceName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {savingDevice ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Subject">
        {editTarget && (
          <SubjectForm
            initial={editTarget}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            loading={saving}
          />
        )}
      </Modal>

      <SyncDialog
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onSynced={() => {
          fetchSubjects();
          loadSyncInfo();
          showToast('Sync complete — gradebook updated');
        }}
      />

      {toast && (
        <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
