'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import GroupForm from '@/components/GroupForm';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import ContextMenu from '@/components/ContextMenu';
import Toast from '@/components/Toast';

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [syncInfo, setSyncInfo] = useState(null);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });

  // One context menu for the list (right-click a row, or its ⋮ button).
  const [menu, setMenu] = useState(null);
  const openMenu = useCallback((x, y, items) => setMenu({ x, y, items }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sync');
        const d = await res.json();
        if (res.ok) setSyncInfo(d);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const myId = syncInfo?.device_id;
  const peerLabels = Object.fromEntries((syncInfo?.peers || []).map(p => [p.device_id, p.label]));
  const ownerLabel = (g) =>
    myId && g.owner_device_id && g.owner_device_id !== myId
      ? (peerLabels[g.owner_device_id] || 'Other laptop')
      : null;
  const hasForeign = groups.some(g => ownerLabel(g));

  const q = search.trim().toLowerCase();
  const filtered = groups.filter(g =>
    !q || `${g.name} ${g.description || ''}`.toLowerCase().includes(q)
  );

  const cmp = (a, b, key) => {
    if (key === 'student_count') return (Number(a.student_count) || 0) - (Number(b.student_count) || 0);
    return String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { sensitivity: 'base', numeric: true });
  };
  const sorted = [...filtered].sort((a, b) => (cmp(a, b, sort.key) || cmp(a, b, 'name')) * sort.dir);
  const toggleSort = (key) =>
    setSort(prev => (prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 }));

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
    showToast('Group moved to the recycle bin');
    fetchGroups();
  };

  const handleDuplicate = async (id) => {
    await fetch(`/api/groups/${id}/duplicate`, { method: 'POST' });
    showToast('Student group duplicated');
    fetchGroups();
  };

  const groupMenuItems = (g) => [
    { label: 'Open', onClick: () => router.push(`/groups/${g.id}`) },
    { label: 'Duplicate', onClick: () => handleDuplicate(g.id) },
    { label: 'Edit…', onClick: () => setEditTarget(g) },
    { label: 'Delete…', danger: true, separatorBefore: true, onClick: () => setDeleteTarget(g) },
  ];

  // Plain render helper (NOT a nested component — lint: static-components).
  const sortHeader = (label, k, className = '') => (
    <th key={k} className={`text-left px-3 py-2 font-medium text-gray-500 select-none ${className}`}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-gray-800">
        {label}
        {sort.key === k && <span className="text-[9px]">{sort.dir === 1 ? '▲' : '▼'}</span>}
      </button>
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Student Groups</h1>
        </div>
        <Link
          href="/"
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
          </svg>
          Subjects
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* One row: wide search + the primary action. */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by group name or description…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Group
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-gray-500 mb-1">No student groups yet</p>
            <p className="text-xs text-gray-400">Create a group (e.g. “BSIS 2A”) once, then import it into any subject.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs">
                  {sortHeader('Group Name', 'name')}
                  {sortHeader('Description', 'description')}
                  {sortHeader('Members', 'student_count', 'w-24')}
                  {hasForeign && <th className="text-left px-3 py-2 font-medium text-gray-500 w-28">Owner</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(g => {
                  const owner = ownerLabel(g);
                  return (
                    <tr
                      key={g.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-blue-50/50 cursor-pointer"
                      onClick={() => router.push(`/groups/${g.id}`)}
                      onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY, groupMenuItems(g)); }}
                      title="Right-click for actions"
                    >
                      <td className="px-3 py-2 text-gray-900 font-medium">{g.name}</td>
                      <td className="px-3 py-2 text-gray-500">{g.description || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                        {Number(g.student_count) || 0} student{(Number(g.student_count) || 0) !== 1 ? 's' : ''}
                      </td>
                      {hasForeign && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {owner
                            ? <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">{owner}</span>
                            : <span className="text-xs text-gray-400">Mine</span>}
                        </td>
                      )}
                      <td className="px-1 py-2 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); openMenu(e.clientX, e.clientY, groupMenuItems(g)); }}
                          className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                          title="Actions"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={hasForeign ? 5 : 4} className="px-3 py-10 text-center text-sm text-gray-400">
                      No groups match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50 border-t border-gray-100">
              {sorted.length} of {groups.length} group{groups.length !== 1 ? 's' : ''}
            </div>
          </div>
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

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { const t = deleteTarget; setDeleteTarget(null); if (t) handleDelete(t.id); }}
        title="Delete Student Group"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? It moves to the recycle bin and can be restored from Settings.` : ''}
      />

      <ContextMenu menu={menu} onClose={closeMenu} />

      {toast && (
        <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
