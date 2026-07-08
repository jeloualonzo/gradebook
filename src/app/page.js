'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SubjectForm from '@/components/SubjectForm';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import ContextMenu from '@/components/ContextMenu';
import Toast from '@/components/Toast';
import { useHotkey } from '@/lib/hooks/useHotkey';

const SEMESTER_LABELS = { '1st': '1st Sem', '2nd': '2nd Sem', 'Summer': 'Summer' };

export default function HomePage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  // First-run: this installation has no friendly name yet ("Jelou's laptop").
  const [needsDeviceName, setNeedsDeviceName] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [savingDevice, setSavingDevice] = useState(false);
  // Sync + ownership: this device's id and the known peers (for the Owner column).
  const [syncInfo, setSyncInfo] = useState(null);

  // List controls — search wide, filters compact, all on one row.
  const [search, setSearch] = useState('');
  const [fSemester, setFSemester] = useState('');
  const [fYear, setFYear] = useState('');
  const [fSection, setFSection] = useState('');
  const [fOwner, setFOwner] = useState('');
  const [sort, setSort] = useState({ key: 'subject_code', dir: 1 });

  // One context menu for the list (right-click a row, or its ⋮ button).
  const [menu, setMenu] = useState(null);
  const openMenu = useCallback((x, y, items) => setMenu({ x, y, items }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const showToast = useCallback(
    (message, type = 'success') => setToast({ message, type, key: Date.now() }),
    []
  );

  // F2 (Windows Explorer-style rename): edit the subject row under the mouse.
  const hoveredRef = useRef(null);
  useHotkey('f2', () => {
    if (menu || editTarget || deleteTarget || needsDeviceName) return;
    if (hoveredRef.current) setEditTarget(hoveredRef.current);
  });

  const fetchSubjects = useCallback(async () => {
    try {
      const res = await fetch('/api/subjects');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch subjects');
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
    setSavingDevice(true);
    try {
      const res = await fetch('/api/device', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_label: deviceName }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save the name');
      setNeedsDeviceName(false);
      showToast('Laptop name saved');
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
    showToast('Subject moved to the recycle bin');
    fetchSubjects();
  };

  const handleDuplicate = async (id) => {
    await fetch(`/api/subjects/${id}/duplicate`, { method: 'POST' });
    showToast('Subject duplicated');
    fetchSubjects();
  };

  // ---- Ownership (shown only when another laptop's subjects are present) ----
  const myId = syncInfo?.device_id;
  const peerLabels = Object.fromEntries((syncInfo?.peers || []).map(p => [p.device_id, p.label]));
  const ownerLabel = (s) =>
    myId && s.owner_device_id && s.owner_device_id !== myId
      ? (peerLabels[s.owner_device_id] || 'Other laptop')
      : null;
  const hasForeign = subjects.some(s => ownerLabel(s));

  // ---- Filters (values from the data itself) --------------------------------
  const distinct = (key) => [...new Set(subjects.map(s => s[key]).filter(Boolean))].sort();
  const semesters = distinct('semester');
  const years = distinct('school_year');
  const sections = distinct('section');

  const q = search.trim().toLowerCase();
  const filtered = subjects.filter(s =>
    (!q || `${s.subject_code} ${s.name} ${s.section}`.toLowerCase().includes(q)) &&
    (!fSemester || s.semester === fSemester) &&
    (!fYear || s.school_year === fYear) &&
    (!fSection || s.section === fSection) &&
    (!fOwner || (fOwner === 'mine' ? !ownerLabel(s) : ownerLabel(s)))
  );

  // ---- Sorting (click a column header; suffix: code-less subjects last) -----
  const cmp = (a, b, key) => {
    const av = key === 'subject_code' ? (a.subject_code || '￿') : String(a[key] ?? '');
    const bv = key === 'subject_code' ? (b.subject_code || '￿') : String(b[key] ?? '');
    return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
  };
  const sorted = [...filtered].sort((a, b) =>
    (cmp(a, b, sort.key) || cmp(a, b, 'name') || cmp(a, b, 'section')) * sort.dir
  );
  const toggleSort = (key) =>
    setSort(prev => (prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 }));

  const subjectMenuItems = (s) => [
    { label: 'Open', onClick: () => router.push(`/subjects/${s.id}`) },
    { label: 'Duplicate', onClick: () => handleDuplicate(s.id) },
    { label: 'Edit…', onClick: () => setEditTarget(s) },
    { label: 'Delete…', danger: true, separatorBefore: true, onClick: () => setDeleteTarget(s) },
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

  const selectClass = 'px-2.5 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Faculty Gradebook</h1>
        </div>
        <Link
          href="/groups"
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
          Student Groups
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* One row: wide search, compact filters, the primary action. */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by code, title, or section…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className={selectClass} value={fSemester} onChange={e => setFSemester(e.target.value)} title="Semester">
            <option value="">Semester</option>
            {semesters.map(v => <option key={v} value={v}>{SEMESTER_LABELS[v] || v}</option>)}
          </select>
          <select className={selectClass} value={fYear} onChange={e => setFYear(e.target.value)} title="School Year">
            <option value="">School Year</option>
            {years.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className={selectClass} value={fSection} onChange={e => setFSection(e.target.value)} title="Section">
            <option value="">Section</option>
            {sections.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {hasForeign && (
            <select className={selectClass} value={fOwner} onChange={e => setFOwner(e.target.value)} title="Owner">
              <option value="">Owner</option>
              <option value="mine">Mine</option>
              <option value="others">Other laptop</option>
            </select>
          )}
          <Link
            href="/subjects/new"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Subject
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
        ) : subjects.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-gray-500 mb-1">No subjects yet</p>
            <p className="text-xs text-gray-400">Create your first subject to start grading.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs">
                  {sortHeader('Code', 'subject_code', 'w-28')}
                  {sortHeader('Subject Title', 'name')}
                  {sortHeader('Section', 'section', 'w-28')}
                  {sortHeader('Semester', 'semester', 'w-24')}
                  {sortHeader('School Year', 'school_year', 'w-28')}
                  {hasForeign && <th className="text-left px-3 py-2 font-medium text-gray-500 w-28">Owner</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const owner = ownerLabel(s);
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-blue-50/50 cursor-pointer"
                      onClick={() => router.push(`/subjects/${s.id}`)}
                      onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY, subjectMenuItems(s)); }}
                      onMouseEnter={() => { hoveredRef.current = s; }}
                      onMouseLeave={() => { if (hoveredRef.current === s) hoveredRef.current = null; }}
                      title="Click to open · right-click for actions · F2 to edit"
                    >
                      <td className="px-3 py-2 font-semibold text-blue-700 whitespace-nowrap">
                        {s.subject_code || <span className="text-gray-300 font-normal">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-900 font-medium">{s.name}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.section}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{SEMESTER_LABELS[s.semester] || s.semester}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.school_year}</td>
                      {hasForeign && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {owner
                            ? <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">{owner}</span>
                            : <span className="text-xs text-gray-400">Mine</span>}
                        </td>
                      )}
                      <td className="px-1 py-2 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); openMenu(e.clientX, e.clientY, subjectMenuItems(s)); }}
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
                    <td colSpan={hasForeign ? 7 : 6} className="px-3 py-10 text-center text-sm text-gray-400">
                      No subjects match your search or filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50 border-t border-gray-100">
              {sorted.length} of {subjects.length} subject{subjects.length !== 1 ? 's' : ''}
            </div>
          </div>
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

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Subject" width="max-w-md">
        {editTarget && (
          <SubjectForm
            initial={editTarget}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            loading={saving}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { const t = deleteTarget; setDeleteTarget(null); if (t) handleDelete(t.id); }}
        title="Delete Subject"
        message={deleteTarget ? `Delete "${deleteTarget.subject_code ? deleteTarget.subject_code + ' — ' : ''}${deleteTarget.name}"? It moves to the recycle bin and can be restored from Settings.` : ''}
      />

      <ContextMenu menu={menu} onClose={closeMenu} />

      {toast && (
        <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
