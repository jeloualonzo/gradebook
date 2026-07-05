'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import GroupCard from '@/components/GroupCard';
import GroupForm from '@/components/GroupForm';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';

export default function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback(
    (message, type = 'success') => setToast({ message, type, key: Date.now() }),
    []
  );

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/groups');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch student groups');
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, 'error');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    (async () => { await fetchGroups(); })();
  }, [fetchGroups]);

  const filtered = groups.filter(g =>
    `${g.name} ${g.description || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (form) => {
    setSaving(true);
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Failed to create group', 'error');
      return;
    }
    setAddOpen(false);
    showToast('Student group created');
    fetchGroups();
  };

  const handleEdit = async (form) => {
    setSaving(true);
    await fetch(`/api/groups/${editTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setEditTarget(null);
    showToast('Student group updated');
    fetchGroups();
  };

  const handleDelete = async (id) => {
    await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    showToast('Student group deleted');
    fetchGroups();
  };

  const handleDuplicate = async (id) => {
    await fetch(`/api/groups/${id}/duplicate`, { method: 'POST' });
    showToast('Student group duplicated');
    fetchGroups();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Student Groups</h1>
          <p className="text-xs text-gray-500 mt-0.5">Reusable rosters you can import into any subject</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
            Subjects
          </Link>
          <button
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Group
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <h2 className="text-base font-medium text-gray-700 mb-1">No student groups yet</h2>
            <p className="text-sm text-gray-400 mb-6">
              Create a group (e.g. &quot;BSIS 2A&quot;) once, then import it into any subject.
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Create Student Group
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-5">
              <input
                className="w-64 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search groups…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <p className="text-sm text-gray-500">
                {filtered.length} group{filtered.length !== 1 ? 's' : ''}
              </p>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-sm text-gray-400">No groups match your search.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map(g => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    onEdit={() => setEditTarget(g)}
                    onDelete={() => handleDelete(g.id)}
                    onDuplicate={() => handleDuplicate(g.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New Student Group" width="max-w-sm">
        <GroupForm onSubmit={handleAdd} onCancel={() => setAddOpen(false)} loading={saving} />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Student Group" width="max-w-sm">
        {editTarget && (
          <GroupForm initial={editTarget} onSubmit={handleEdit} onCancel={() => setEditTarget(null)} loading={saving} />
        )}
      </Modal>

      {toast && (
        <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
