'use client';
import { useState, useEffect } from 'react';
import SubjectCard from '@/components/SubjectCard';
import Modal from '@/components/Modal';
import SubjectForm from '@/components/SubjectForm';
import Toast from '@/components/Toast';
import Link from 'next/link';

export default function HomePage() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const fetchSubjects = async () => {
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
  };

  useEffect(() => { fetchSubjects(); }, []);

  const showToast = (message, type = 'success') => setToast({ message, type, key: Date.now() });

  const handleAdd = async (form) => {
    setSaving(true);
    const res = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const { id } = await res.json();
    setSaving(false);
    setAddOpen(false);
    showToast('Subject created');
    await fetchSubjects();
    window.location.href = `/subjects/new?id=${id}`;
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
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Subject
        </button>
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
            <button
              onClick={() => setAddOpen(true)}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Create Subject
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm text-gray-500">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {subjects.map(s => (
                <SubjectCard
                  key={s.id}
                  subject={s}
                  onEdit={() => setEditTarget(s)}
                  onDelete={() => handleDelete(s.id)}
                  onDuplicate={() => handleDuplicate(s.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New Subject">
        <SubjectForm
          onSubmit={handleAdd}
          onCancel={() => setAddOpen(false)}
          loading={saving}
        />
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

      {toast && (
        <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
