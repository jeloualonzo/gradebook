'use client';
import { useState, useEffect, useCallback } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

function BinItem({ title, details, deletedAt, deletedBy, onRestore, onPurge, busy }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
        {details && <div className="text-xs text-gray-500 mt-0.5 truncate">{details}</div>}
        <div className="text-[11px] text-gray-400 mt-0.5">
          Deleted {fmtWhen(deletedAt)}{deletedBy ? ` · by ${deletedBy}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onRestore}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Restore
        </button>
        <button
          onClick={onPurge}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
        >
          Delete Permanently
        </button>
      </div>
    </div>
  );
}

/**
 * Recently Deleted panel (rendered inside Settings): deleted subjects and
 * student groups with Restore / Delete Permanently.
 */
export default function RecycleBinPanel() {
  const [data, setData] = useState({ subjects: [], groups: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  // { kind: 'subject' | 'group', id, name } awaiting permanent-delete confirmation
  const [confirmPurge, setConfirmPurge] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/recycle-bin');
      const d = await res.json();
      if (res.ok) setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (path, successMessage) => {
    setBusy(true);
    try {
      const res = await fetch(path, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'The action failed.');
      setToast({ message: successMessage, type: 'success', key: Date.now() });
      await load();
    } catch (err) {
      setToast({ message: err.message, type: 'error', key: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  const empty = !loading && data.subjects.length === 0 && data.groups.length === 0;

  return (
    <div className="space-y-8">
        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
        ) : empty ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            The recycle bin is empty.
          </div>
        ) : (
          <>
            {data.subjects.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Subjects</h2>
                <div className="space-y-2">
                  {data.subjects.map(s => (
                    <BinItem
                      key={s.id}
                      title={`${s.name} — ${s.section}`}
                      details={`${s.school_year} · ${s.semester} · ${s.student_count} student${s.student_count !== 1 ? 's' : ''} · ${s.score_count} score${s.score_count !== 1 ? 's' : ''}`}
                      deletedAt={s.deleted_at}
                      deletedBy={s.deleted_by}
                      busy={busy}
                      onRestore={() => act(`/api/subjects/${s.id}/restore`, `"${s.name}" restored with all its data.`)}
                      onPurge={() => setConfirmPurge({ kind: 'subject', id: s.id, name: s.name })}
                    />
                  ))}
                </div>
              </section>
            )}

            {data.groups.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Student Groups</h2>
                <div className="space-y-2">
                  {data.groups.map(g => (
                    <BinItem
                      key={g.id}
                      title={g.name}
                      details={`${g.member_count} member${g.member_count !== 1 ? 's' : ''}${g.description ? ` · ${g.description}` : ''}`}
                      deletedAt={g.deleted_at}
                      deletedBy={g.deleted_by}
                      busy={busy}
                      onRestore={() => act(`/api/groups/${g.id}/restore`, `"${g.name}" restored with all its members.`)}
                      onPurge={() => setConfirmPurge({ kind: 'group', id: g.id, name: g.name })}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

      <ConfirmDialog
        open={confirmPurge !== null}
        onClose={() => setConfirmPurge(null)}
        onConfirm={() => {
          const t = confirmPurge;
          setConfirmPurge(null);
          if (t) act(`/api/${t.kind === 'subject' ? 'subjects' : 'groups'}/${t.id}/purge`, `"${t.name}" permanently deleted.`);
        }}
        title="Delete Permanently"
        message={`Permanently delete "${confirmPurge?.name}"? It will disappear from the recycle bin on both laptops and can no longer be restored.`}
      />

      {toast && <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
