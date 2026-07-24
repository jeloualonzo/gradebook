'use client';
import { useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGradebook } from '@/lib/hooks/useGradebook';
import { useHistory } from '@/lib/hooks/useHistory';
import { usePageTitle } from '@/lib/hooks/usePageTitle';
import ScoreCell from '@/components/ScoreCell';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import { formatNumber } from '@/lib/gradeCalculator';
import { toDateInputValue, formatDateMMDDYYYY } from '@/lib/dateUtils';
import { displayName } from '@/lib/names';
import {
  isWorkspace, workspaceAggregate, workspaceStatus, workspaceSummary,
  AGG_METHODS, aggMethodLabel, STATUS_LABELS,
} from '@/lib/workspace';

/**
 * The Workspace (v1.9.0) — the dedicated management surface behind a
 * workspace assessment's single computed gradebook column.
 *
 * Same machinery as the main grid BY CONSTRUCTION: the cells are the same
 * ScoreCells (autosave, session undo, two-mode protection, Escape — all
 * ride along) writing the same scores rows; sessions and period buckets are
 * ordinary assessment_columns. This page adds the management chrome: a
 * toolbar (search · status filters · sessions/periods · settings), a
 * summary panel, and Expected / Completed / N/A visibility.
 */

const PERIOD_TYPES = ['PRELIM', 'MIDTERM', 'FINAL'];

const btn = 'px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50';
const chip = (active) =>
  `px-2.5 py-1 text-xs rounded-full border ${active ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;

/** Edit computation method / target / weight — teacher language throughout. */
function WorkspaceSettingsDialog({ assessment, onSave, onClose }) {
  const [method, setMethod] = useState(assessment.agg_method || 'sum');
  const [target, setTarget] = useState(assessment.agg_max ?? '');
  const [weight, setWeight] = useState(assessment.weight_percent ?? 0);
  const methodInfo = AGG_METHODS.find(m => m.id === method);
  const term = assessment.span === 'term';
  const row = 'flex items-center justify-between gap-3 py-1.5';
  return (
    <Modal open onClose={onClose} title="Workspace Settings" width="max-w-sm">
      {!term && (
        <>
          <div className={row}>
            <span className="text-xs text-gray-600">Computation</span>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AGG_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          {methodInfo?.hint && <p className="text-[11px] text-gray-400 text-right mb-1">{methodInfo.hint}</p>}
          <div className={row}>
            <span className="text-xs text-gray-600">Target total</span>
            <input
              type="number" min="0" value={target} onChange={e => setTarget(e.target.value)}
              placeholder={method === 'average' ? '100' : '—'}
              className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </>
      )}
      <div className={row}>
        <span className="text-xs text-gray-600">Weight %</span>
        <input
          type="number" min="0" max="100" value={weight} onChange={e => setWeight(e.target.value)}
          className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Changing the computation only changes how the gradebook column is calculated — every recorded score stays exactly as entered.
      </p>
      <div className="flex items-center justify-end gap-2 mt-3">
        <button onClick={onClose} className={btn}>Cancel</button>
        <button
          onClick={() => onSave({
            agg_method: method,
            agg_max: target === '' ? null : parseFloat(target) || null,
            weight_percent: parseFloat(weight) || 0,
          })}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export default function WorkspacePage() {
  const { id, assessmentId } = useParams();
  const router = useRouter();
  const {
    subject, periods, students, scores,
    loading, error,
    updateScore, patchColumnLocal, refreshPeriods, refreshScores,
  } = useGradebook(id);

  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type, k: Date.now() }), []);
  const history = useHistory({ onNotify: showToast });

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editPeriod, setEditPeriod] = useState('PRELIM'); // term-span: the bucket being edited
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteSession, setDeleteSession] = useState(null);

  // The RAW assessment (all sessions / all buckets) + its owning period.
  // Plain derivation — the React Compiler memoizes it; the assessment
  // reference itself is stable (it comes straight out of `periods`).
  let found = null;
  for (const p of periods) {
    const a = (p.assessments || []).find(x => String(x.id) === String(assessmentId));
    if (a) { found = { assessment: a, period: p }; break; }
  }
  const assessment = found?.assessment;
  const term = assessment?.span === 'term';

  usePageTitle(assessment && subject ? `${assessment.name} — ${subject.name} — Workspace` : 'Workspace');

  const summary = useMemo(
    () => (assessment ? workspaceSummary(assessment, students, scores) : null),
    [assessment, students, scores]
  );

  // Sessions (period-span) or the selected period's bucket (term-span).
  const sessionColumns = useMemo(() => (assessment && !term ? assessment.columns || [] : []), [assessment, term]);
  const bucket = useMemo(
    () => (assessment && term ? (assessment.columns || []).find(c => c.period_type === editPeriod) || null : null),
    [assessment, term, editPeriod]
  );

  const visibleStudents = useMemo(() => {
    let list = students;
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter(s => displayName(s).toLowerCase().includes(needle));
    if (statusFilter !== 'all' && assessment) {
      list = list.filter(s => workspaceStatus(assessment, scores, String(s.id), term ? editPeriod : found.period.type) === statusFilter);
    }
    return list;
  }, [students, q, statusFilter, assessment, scores, term, editPeriod, found]);

  const rosterNumbers = useMemo(() => new Map(students.map((s, i) => [String(s.id), i + 1])), [students]);

  // ---- column mutations (optimistic + undoable, main-grid patterns) ----------
  const putColumn = async (colId, body) => {
    const res = await fetch(`/api/columns/${colId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Save failed');
  };

  const commitField = async (col, field, rawValue, label) => {
    const prev = field === 'date' ? (toDateInputValue(col.date) || null) : col[field];
    let next = rawValue;
    if (field === 'max_score') next = parseFloat(rawValue) || 0;
    if (field === 'date') next = rawValue || null;
    if (field === 'label') next = String(rawValue || '').trim();
    if (String(next ?? '') === String(prev ?? '')) return;
    const apply = (v) => patchColumnLocal(col.id, { [field]: v });
    apply(next);
    try {
      await putColumn(col.id, { [field]: next });
    } catch {
      apply(prev);
      showToast('Could not save — value restored.', 'error');
      return;
    }
    history.push({
      label,
      undo: async () => { apply(prev); await putColumn(col.id, { [field]: prev }); },
      redo: async () => { apply(next); await putColumn(col.id, { [field]: next }); },
    });
  };

  const addSession = async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const body = { date: iso, max_score: 10 };
    const res = await fetch(`/api/assessments/${assessmentId}/columns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    refreshPeriods();
    if (res.ok && json?.id) {
      let colId = json.id;
      history.push({
        label: 'add session',
        undo: async () => { await fetch(`/api/columns/${colId}`, { method: 'DELETE' }); refreshPeriods(); refreshScores(); },
        redo: async () => {
          const r = await fetch(`/api/assessments/${assessmentId}/columns`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const j = await r.json().catch(() => ({}));
          if (j?.id) colId = j.id;
          refreshPeriods();
        },
      });
    }
  };

  const confirmDeleteSession = async () => {
    const col = deleteSession;
    setDeleteSession(null);
    if (!col) return;
    const columnScores = scores?.[col.id] ? { ...scores[col.id] } : {};
    const body = { date: toDateInputValue(col.date) || null, max_score: col.max_score, label: col.label || '' };
    await fetch(`/api/columns/${col.id}`, { method: 'DELETE' });
    refreshPeriods();
    refreshScores();
    let currentId = col.id;
    history.push({
      label: 'remove session',
      undo: async () => {
        const r = await fetch(`/api/assessments/${assessmentId}/columns`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (j?.id) {
          currentId = j.id;
          const entries = Object.entries(columnScores)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([sid, v]) => ({ column_id: currentId, student_id: sid, value: v }));
          if (entries.length) {
            await fetch('/api/scores/bulk', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }),
            });
          }
        }
        refreshPeriods();
        refreshScores();
      },
      redo: async () => {
        await fetch(`/api/columns/${currentId}`, { method: 'DELETE' });
        refreshPeriods();
        refreshScores();
      },
    });
  };

  // Term-span: ONE max score, kept identical across all three buckets.
  const commitBucketMax = async (rawValue) => {
    const next = parseFloat(rawValue) || 0;
    const buckets = (assessment?.columns || []);
    const prevByCol = new Map(buckets.map(c => [c.id, c.max_score]));
    if (buckets.every(c => String(c.max_score) === String(next))) return;
    const applyAll = async (valueOf) => {
      for (const c of buckets) {
        patchColumnLocal(c.id, { max_score: valueOf(c) });
        await putColumn(c.id, { max_score: valueOf(c) });
      }
    };
    try {
      await applyAll(() => next);
    } catch {
      showToast('Could not save the max score.', 'error');
      refreshPeriods();
      return;
    }
    history.push({
      label: 'change max score',
      undo: async () => { await applyAll(c => prevByCol.get(c.id)); },
      redo: async () => { await applyAll(() => next); },
    });
  };

  const saveSettings = async (fields) => {
    setSettingsOpen(false);
    const prev = {
      agg_method: assessment.agg_method,
      agg_max: assessment.agg_max,
      weight_percent: assessment.weight_percent,
    };
    const put = async (body) => {
      const res = await fetch(`/api/assessments/${assessmentId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      refreshPeriods();
    };
    try {
      await put(fields);
    } catch {
      showToast('Could not save the settings.', 'error');
      return;
    }
    history.push({
      label: 'edit workspace settings',
      undo: async () => { await put(prev); },
      redo: async () => { await put(fields); },
    });
    showToast('Workspace settings saved');
  };

  // ---- rendering ---------------------------------------------------------------
  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-sm text-gray-400">Loading workspace…</div></div>;
  }
  if (error || !subject || !assessment || !isWorkspace(assessment)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600 mb-4">{error || 'This workspace was not found.'}</p>
          <Link href={`/subjects/${id}`} className="text-sm text-blue-600 hover:underline">← Back to the gradebook</Link>
        </div>
      </div>
    );
  }

  const statusChips = term ? ['all', 'completed', 'expected', 'not_applicable'] : ['all', 'completed', 'expected'];
  const cfgLine = term
    ? `Whole term · max ${formatNumber(bucket?.max_score ?? assessment.columns?.[0]?.max_score ?? 100)} · counts in the period where each student is scored`
    : `${aggMethodLabel(assessment.agg_method)}${assessment.agg_max ? ` · target ${formatNumber(assessment.agg_max)}` : ''} · ${found.period.type}`;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ---- Workspace toolbar ------------------------------------------------ */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 shrink-0 flex-wrap">
        <button onClick={() => router.push(`/subjects/${id}`)} className="text-gray-400 hover:text-gray-700 transition-colors" title="Back to the gradebook">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="min-w-0 mr-2">
          <h1 className="text-sm font-semibold text-gray-900 truncate">
            {assessment.name}
            <span className="ml-2 text-[10px] font-semibold tracking-wide uppercase text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">Workspace</span>
          </h1>
          <p className="text-xs text-gray-500 truncate">{subject.name} · {cfgLine}</p>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Find a student…"
          className="w-44 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Status filter */}
        <div className="flex items-center gap-1">
          {statusChips.map(s => (
            <button key={s} className={chip(statusFilter === s)} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-200" aria-hidden="true" />

        {/* Undo/redo — the same session model as the grid */}
        <div className="flex items-center gap-1">
          <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" className="p-1.5 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" /></svg>
          </button>
          <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)" className="p-1.5 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" /></svg>
          </button>
        </div>

        {!term && (
          <button onClick={addSession} className={`${btn} flex items-center gap-1.5`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add session
          </button>
        )}
        {term && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Max
            <input
              key={`max-${bucket?.id}-${formatNumber(bucket?.max_score ?? 0)}`}
              type="number"
              min="0"
              defaultValue={formatNumber(bucket?.max_score ?? 100)}
              onBlur={e => commitBucketMax(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Max score — the same for every grading period"
            />
          </label>
        )}
        <button onClick={() => setSettingsOpen(true)} className={btn} title="Computation, target, weight">Settings</button>
      </header>

      {/* ---- Summary panel ----------------------------------------------------- */}
      {summary && (
        <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-6 text-xs shrink-0 flex-wrap">
          <span className="text-gray-600">
            <span className="font-semibold text-gray-800">{summary.completed} of {summary.total}</span> completed
          </span>
          <span
            className={summary.expected > 0 ? 'text-amber-700' : 'text-gray-400'}
            title={summary.expected > 0 ? summary.expectedStudents.map(displayName).join('\n') : ''}
          >
            <span className="font-semibold">{summary.expected}</span> expected
          </span>
          {summary.avg !== null && (
            <>
              <span className="text-gray-400">Average <span className="font-semibold text-gray-700">{formatNumber(summary.avg)}</span></span>
              <span className="text-gray-400">Highest <span className="font-semibold text-gray-700">{formatNumber(summary.high)}</span></span>
              <span className="text-gray-400">Lowest <span className="font-semibold text-gray-700">{formatNumber(summary.low)}</span></span>
            </>
          )}
          {term && (
            <div className="ml-auto flex items-center gap-1">
              {PERIOD_TYPES.map(pt => {
                const n = students.filter(s => workspaceStatus(assessment, scores, String(s.id), pt) === 'completed').length;
                return (
                  <button key={pt} className={chip(editPeriod === pt)} onClick={() => setEditPeriod(pt)} title={`Edit ${pt} scores`}>
                    {pt}{n > 0 ? ` · ${n}` : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- Content ------------------------------------------------------------ */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto inline-block max-w-full">
          <table data-grid-scope className="gradebook-table text-xs w-max">
            <thead>
              <tr>
                <th className="bg-white w-9 text-center text-gray-400 px-2 py-1.5">#</th>
                <th className="bg-white text-left px-3 py-1.5 min-w-[180px]">Student</th>
                {!term && sessionColumns.map((col, i) => (
                  <th key={col.id} className="bg-white px-1 py-1 text-center align-top" style={{ width: '96px' }}>
                    <input
                      key={`t-${col.id}-${col.label || ''}`}
                      defaultValue={col.label || ''}
                      placeholder={`Session ${i + 1}`}
                      onBlur={e => commitField(col, 'label', e.target.value, 'rename session')}
                      onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                      className="w-full text-[10px] font-medium text-gray-700 text-center border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-300"
                    />
                    <input
                      key={`d-${col.id}-${col.date || ''}`}
                      type="date"
                      defaultValue={toDateInputValue(col.date) || ''}
                      onBlur={e => commitField(col, 'date', e.target.value, 'change date')}
                      onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                      className="w-full text-[9px] text-gray-500 text-center border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                      title={col.date ? formatDateMMDDYYYY(col.date) : 'Set the session date'}
                    />
                    <div className="flex items-center justify-center gap-1">
                      <input
                        key={`m-${col.id}-${formatNumber(col.max_score)}`}
                        type="number"
                        min="0"
                        defaultValue={formatNumber(col.max_score)}
                        onFocus={e => e.target.select()}
                        onBlur={e => commitField(col, 'max_score', e.target.value, 'change max score')}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                        className="w-12 text-[10px] text-gray-600 text-center border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                        title="Max score"
                      />
                      <button
                        onClick={() => setDeleteSession(col)}
                        className="text-gray-300 hover:text-red-600 text-[10px] leading-none p-0.5"
                        title="Delete this session"
                      >
                        ✕
                      </button>
                    </div>
                  </th>
                ))}
                {!term && sessionColumns.length === 0 && (
                  <th className="bg-white px-6 py-1.5 text-center text-gray-300 font-normal">No sessions yet — Add session to begin</th>
                )}
                {term && (
                  <th className="bg-white px-2 py-1.5 text-center" style={{ width: '96px' }}>
                    {editPeriod} score
                    <span className="block text-[9px] font-normal text-gray-400">max {formatNumber(bucket?.max_score ?? 0)}</span>
                  </th>
                )}
                <th className="bg-gray-50 px-2 py-1.5 text-center border-l-2 border-gray-300" style={{ width: '88px' }}>
                  Computed
                  <span className="block text-[9px] font-normal text-gray-400">
                    {term ? 'whole term' : aggMethodLabel(assessment.agg_method).toLowerCase()}
                  </span>
                </th>
                <th className="bg-gray-50 px-2 py-1.5 text-center" style={{ width: '110px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.length === 0 && (
                <tr><td colSpan={4 + (term ? 0 : Math.max(sessionColumns.length, 1) - 1)} className="text-center py-8 text-gray-400">No students match.</td></tr>
              )}
              {visibleStudents.map(student => {
                const sid = String(student.id);
                const statusHere = workspaceStatus(assessment, scores, sid, term ? editPeriod : found.period.type);
                const agg = workspaceAggregate(assessment, scores, sid);
                let statusText = STATUS_LABELS[statusHere];
                if (statusHere === 'not_applicable') {
                  const other = (assessment.columns || []).find(c => {
                    const v = scores?.[c.id]?.[sid];
                    return v !== undefined && v !== null && v !== '' && c.period_type !== editPeriod;
                  });
                  if (other?.period_type) statusText = `N/A — in ${other.period_type}`;
                }
                return (
                  <tr key={student.id} data-student-row={student.id}>
                    <td className="text-center text-gray-400 py-1 bg-white">{rosterNumbers.get(sid)}</td>
                    <td className="px-3 py-1 font-medium text-gray-800 bg-white whitespace-nowrap">{displayName(student)}</td>
                    {!term && sessionColumns.map(col => (
                      <td key={col.id} className="p-0 border-r border-gray-100">
                        <ScoreCell
                          columnId={col.id}
                          studentId={student.id}
                          initialValue={scores?.[col.id]?.[student.id]}
                          maxScore={col.max_score}
                          onUpdate={updateScore}
                          onHistoryPush={history.push}
                          onSaveError={(m) => showToast(m, 'error')}
                        />
                      </td>
                    ))}
                    {!term && sessionColumns.length === 0 && <td className="bg-gray-50/60" />}
                    {term && (
                      <td className="p-0 border-r border-gray-100">
                        {bucket ? (
                          <ScoreCell
                            columnId={bucket.id}
                            studentId={student.id}
                            initialValue={scores?.[bucket.id]?.[student.id]}
                            maxScore={bucket.max_score}
                            onUpdate={updateScore}
                            onHistoryPush={history.push}
                            onSaveError={(m) => showToast(m, 'error')}
                          />
                        ) : <span className="block text-center text-gray-300 py-1.5">—</span>}
                      </td>
                    )}
                    <td className="text-center py-1.5 bg-gray-50/70 font-semibold text-gray-800 border-l-2 border-gray-300">
                      {agg ? `${formatNumber(agg.earned)} / ${formatNumber(agg.max)}` : '—'}
                    </td>
                    <td className={`text-center py-1.5 text-[11px] ${
                      statusHere === 'completed' ? 'text-green-700' : statusHere === 'expected' ? 'text-amber-700' : 'text-gray-400'
                    }`}>
                      {statusText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Everything autosaves and syncs exactly like the gradebook · Enter moves down · Ctrl+Z undoes
          {term ? ' · switch the grading period above to record scores where they count' : ''}
        </p>
      </div>

      {settingsOpen && (
        <WorkspaceSettingsDialog assessment={assessment} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      )}
      <ConfirmDialog
        open={!!deleteSession}
        onClose={() => setDeleteSession(null)}
        onConfirm={confirmDeleteSession}
        title="Delete Session"
        message={deleteSession ? `Delete ${deleteSession.label || 'this session'}${deleteSession.date ? ` (${formatDateMMDDYYYY(deleteSession.date)})` : ''}? Its scores will be removed. Ctrl+Z restores everything.` : ''}
      />
      {toast && <Toast key={toast.k} message={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
