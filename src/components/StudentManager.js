'use client';
import { useState } from 'react';
import { displayName, searchText } from '@/lib/names';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import StudentForm from './StudentForm';

export default function StudentManager({ subjectId, students, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // Save the current roster as a reusable Student Group (a copy).
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMsg, setGroupMsg] = useState(null); // { text, ok }
  const [savingGroup, setSavingGroup] = useState(false);

  const saveAsGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    setSavingGroup(true);
    setGroupMsg(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/create-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not create the group');
      setGroupMsg({ text: `Student Group “${name}” created with ${d.added} student${d.added !== 1 ? 's' : ''}.`, ok: true });
      setGroupOpen(false);
      setGroupName('');
    } catch (err) {
      setGroupMsg({ text: err.message, ok: false });
    } finally {
      setSavingGroup(false);
    }
  };

  const filtered = students.filter(s =>
    searchText(s).includes(search.toLowerCase())
  );

  const handleAdd = async (form) => {
    setLoading(true);
    await fetch(`/api/subjects/${subjectId}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    setOpen(false);
    onRefresh();
  };

  const handleEdit = async (form) => {
    setLoading(true);
    await fetch(`/api/students/${editTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setLoading(false);
    setEditTarget(null);
    onRefresh();
  };

  const handleDelete = async () => {
    await fetch(`/api/students/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    onRefresh();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <input
          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search students…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Student
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            {students.length === 0 ? 'No students added yet.' : 'No results found.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">#</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Name</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-3 py-1.5 text-gray-800">
                    {displayName(s)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditTarget(s)} className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button onClick={() => setDeleteTarget(s)} className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {students.length > 0 && (
        <div className="mt-3">
          {groupOpen ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Group name, e.g. BSIT 2A (2026)"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveAsGroup()}
              />
              <button
                onClick={saveAsGroup}
                disabled={savingGroup || !groupName.trim()}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {savingGroup ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => { setGroupOpen(false); setGroupMsg(null); }} className="text-gray-400 hover:text-gray-600 px-1">✕</button>
            </div>
          ) : (
            <button
              onClick={() => { setGroupOpen(true); setGroupMsg(null); }}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              title="Creates a reusable copy in Student Groups — this subject is not changed"
            >
              Save these {students.length} student{students.length !== 1 ? 's' : ''} as a Student Group…
            </button>
          )}
          {groupMsg && (
            <p className={`text-xs mt-1.5 ${groupMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{groupMsg.text}</p>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add Student" width="max-w-sm">
        <StudentForm onSubmit={handleAdd} onCancel={() => setOpen(false)} loading={loading} />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Student" width="max-w-sm">
        {editTarget && (
          <StudentForm initial={editTarget} onSubmit={handleEdit} onCancel={() => setEditTarget(null)} loading={loading} />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove Student"
        message={deleteTarget ? `Remove ${displayName(deleteTarget)}? Their scores will be deleted.` : ''}
      />
    </div>
  );
}
