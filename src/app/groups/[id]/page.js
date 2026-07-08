'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import StudentForm from '@/components/StudentForm';
import { displayName, searchText } from '@/lib/names';
import GroupForm from '@/components/GroupForm';
import CaseActionsBar from '@/components/CaseActionsBar';
import { applyCase } from '@/lib/textCase';
import { useHotkey } from '@/lib/hooks/useHotkey';
import { usePageTitle } from '@/lib/hooks/usePageTitle';
import ExcelImportDialog from '@/components/ExcelImportDialog';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** Draggable table row for a group student. */
function SortableStudentRow({ student, index, dragDisabled, onEdit, onDelete, checked, onToggle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: student.id,
    disabled: dragDisabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      onDoubleClick={onEdit}
      title="Double-click to edit"
      className={`border-b border-gray-50 hover:bg-gray-50 ${isDragging ? 'opacity-60 bg-blue-50 relative z-10' : ''}`}
    >
      <td className="px-2 py-1.5 w-8">
        <input type="checkbox" checked={checked} onChange={onToggle} onPointerDown={e => e.stopPropagation()} />
      </td>
      <td className="px-2 py-1.5 w-8">
        <span
          {...attributes}
          {...(dragDisabled ? {} : listeners)}
          className={`inline-flex p-1 text-gray-300 ${dragDisabled ? 'opacity-30' : 'cursor-grab active:cursor-grabbing hover:text-gray-500'}`}
          title={dragDisabled ? 'Clear search to reorder' : 'Drag to reorder'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </span>
      </td>
      <td className="px-3 py-1.5 text-gray-400 text-xs w-10">{index + 1}</td>
      <td className="px-3 py-1.5 text-gray-800">
        {displayName(student)}
      </td>
      <td className="px-2 py-1.5 w-16">
        <div className="flex gap-1 justify-end">
          <button onClick={onEdit} className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function GroupDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [group, setGroup] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  // Excel-style bulk cleanup: select members, change their name casing at once.
  const [selected, setSelected] = useState(() => new Set());
  const [caseBusy, setCaseBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editGroupOpen, setEditGroupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback(
    (message, type = 'success') => setToast({ message, type, key: Date.now() }),
    []
  );

  usePageTitle(group?.name || null);

  // F2 (Windows Explorer-style rename): with exactly one member selected,
  // edit that student; otherwise rename the group you're looking at.
  const anyDialogOpen = addOpen || !!editTarget || !!deleteTarget || editGroupOpen || importOpen;
  useHotkey('f2', () => {
    if (anyDialogOpen || !group) return;
    if (selected.size === 1) {
      const target = students.find(st => selected.has(st.id));
      if (target) { setEditTarget(target); return; }
    }
    setEditGroupOpen(true);
  });

  const fetchGroup = useCallback(async () => {
    try {
      const res = await fetch(`/api/groups/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Group not found');
      setGroup(data);
      setStudents(Array.isArray(data.students) ? data.students : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    (async () => { await fetchGroup(); })();
  }, [fetchGroup]);

  const refreshStudents = useCallback(async () => {
    const res = await fetch(`/api/groups/${id}/students`);
    if (res.ok) {
      const data = await res.json();
      setStudents(Array.isArray(data) ? data : []);
    }
  }, [id]);

  const filtered = students.filter(s =>
    searchText(s).includes(search.toLowerCase())
  );
  const dragDisabled = search.trim() !== '';

  const handleAdd = async (form) => {
    setSaving(true);
    await fetch(`/api/groups/${id}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setAddOpen(false);
    showToast('Student added');
    refreshStudents();
  };

  const handleEdit = async (form) => {
    setSaving(true);
    await fetch(`/api/group-students/${editTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setEditTarget(null);
    showToast('Student updated');
    refreshStudents();
  };

  const handleDelete = async () => {
    await fetch(`/api/group-students/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteTarget(null);
    showToast('Student removed');
    refreshStudents();
  };

  const handleEditGroup = async (form) => {
    setSaving(true);
    await fetch(`/api/groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setEditGroupOpen(false);
    showToast('Group updated');
    fetchGroup();
  };

  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Apply a case mode to the selected members' NAME fields (suffixes like
  // "Jr." or "III" are deliberately left untouched).
  const applyCaseToSelected = async (modeId) => {
    setCaseBusy(true);
    const targets = students.filter(st => selected.has(st.id));
    for (const st of targets) {
      await fetch(`/api/group-students/${st.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_name: applyCase(st.last_name, modeId),
          first_name: applyCase(st.first_name, modeId),
          middle_name: applyCase(st.middle_name || '', modeId),
          suffix: st.suffix || '',
        }),
      });
    }
    setCaseBusy(false);
    setSelected(new Set());
    refreshStudents();
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = students.findIndex(s => s.id === active.id);
    const newIdx = students.findIndex(s => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(students, oldIdx, newIdx);
    setStudents(reordered); // layout updates immediately
    await fetch(`/api/group-students/${active.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder: true, ids: reordered.map(s => s.id) }),
    });
    refreshStudents();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading group…</div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600 mb-4">{error || 'Group not found'}</p>
          <button onClick={() => router.push('/groups')} className="text-sm text-blue-600 hover:underline">
            ← Back to student groups
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button onClick={() => router.push('/groups')} className="text-gray-400 hover:text-gray-700 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-gray-900 truncate">{group.name}</h1>
            <button
              onClick={() => setEditGroupOpen(true)}
              className="p-1 text-gray-300 hover:text-gray-600 transition-colors"
              title="Edit group"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 truncate">
            {group.description || 'Student group'} · {students.length} student{students.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import from Excel
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Student
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-3">
          <input
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search students…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <CaseActionsBar
          count={selected.size}
          busy={caseBusy}
          onApply={applyCaseToSelected}
          onClear={() => setSelected(new Set())}
        />

        <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              {students.length === 0
                ? 'No students yet. Add students manually or import from Excel.'
                : 'No results found.'}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every(st => selected.has(st.id))}
                        onChange={() => setSelected(
                          filtered.every(st => selected.has(st.id)) ? new Set() : new Set(filtered.map(st => st.id))
                        )}
                        title="Select all"
                      />
                    </th>
                    <th className="w-8" />
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-10">#</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Name</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  <SortableContext items={filtered.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {filtered.map((s, i) => (
                      <SortableStudentRow
                        key={s.id}
                        student={s}
                        index={i}
                        checked={selected.has(s.id)}
                        onToggle={() => toggleSelected(s.id)}
                        dragDisabled={dragDisabled}
                        onEdit={() => setEditTarget(s)}
                        onDelete={() => setDeleteTarget(s)}
                      />
                    ))}
                  </SortableContext>
                </tbody>
              </table>
            </DndContext>
          )}
        </div>
        {dragDisabled && students.length > 1 && (
          <p className="text-xs text-gray-400 mt-2">Clear the search box to drag students into a new order.</p>
        )}
      </main>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Student" width="max-w-sm">
        <StudentForm onSubmit={handleAdd} onCancel={() => setAddOpen(false)} loading={saving} />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Student" width="max-w-sm">
        {editTarget && (
          <StudentForm initial={editTarget} onSubmit={handleEdit} onCancel={() => setEditTarget(null)} loading={saving} />
        )}
      </Modal>

      <Modal open={editGroupOpen} onClose={() => setEditGroupOpen(false)} title="Edit Student Group" width="max-w-sm">
        {editGroupOpen && (
          <GroupForm initial={group} onSubmit={handleEditGroup} onCancel={() => setEditGroupOpen(false)} loading={saving} />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove Student"
        message={deleteTarget ? `Remove ${deleteTarget.last_name}, ${deleteTarget.first_name} from this group? Subjects that already imported this student are not affected.` : ''}
      />

      <ExcelImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        groupId={id}
        existingStudents={students}
        onImported={({ added, skipped }) => {
          showToast(`Imported ${added} student${added !== 1 ? 's' : ''}${skipped ? ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)` : ''}`);
          refreshStudents();
        }}
      />

      {toast && (
        <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
