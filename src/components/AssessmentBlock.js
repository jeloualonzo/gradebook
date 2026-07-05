'use client';
import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { formatNumber } from '@/lib/gradeCalculator';
import { toDateInputValue, formatDateMMDDYYYY } from '@/lib/dateUtils';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Sortable <th> wrapper for the assessment name header cell. Dragging this
 * block reorders the assessment within its own grading period.
 */
function SortableHeaderCell({ id, periodId, colSpan, className, dragDisabled, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { periodId },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <th
      ref={setNodeRef}
      colSpan={colSpan}
      style={style}
      className={`${className} ${isDragging ? 'opacity-60 ring-2 ring-blue-400 relative z-30' : dragDisabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      {...attributes}
      {...(dragDisabled ? {} : listeners)}
    >
      {children}
    </th>
  );
}

export default function AssessmentBlock({
  assessment,
  periodId,
  periodAssessments,
  colors,
  mode,
  onRefresh,
  onRefreshData,
  scores,
  history,
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(assessment.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingDate, setAddingDate] = useState(false);
  const [editingWeight, setEditingWeight] = useState(false);
  const [weight, setWeight] = useState(assessment.weight_percent);
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState(null);
  const [editingDate, setEditingDate] = useState(null);

  // Keep local edit buffers in sync when the assessment changes externally
  // (e.g. after an undo/redo refresh). Render-time adjustment per React docs.
  const [prevAssessmentName, setPrevAssessmentName] = useState(assessment.name);
  if (prevAssessmentName !== assessment.name) {
    setPrevAssessmentName(assessment.name);
    setName(assessment.name);
  }
  const [prevWeightPercent, setPrevWeightPercent] = useState(assessment.weight_percent);
  if (prevWeightPercent !== assessment.weight_percent) {
    setPrevWeightPercent(assessment.weight_percent);
    setWeight(assessment.weight_percent);
  }

  const colSpan = Math.max(assessment.columns.length, 1);

  // Refresh periods AND scores when an operation may touch score data.
  const refreshAll = () => (onRefreshData ? onRefreshData() : onRefresh());

  // --- Low-level API helpers -------------------------------------------------
  const putAssessment = (body) =>
    fetch(`/api/assessments/${assessment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const putColumn = (colId, body) =>
    fetch(`/api/columns/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const postColumn = async (body) => {
    const res = await fetch(`/api/assessments/${assessment.id}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json?.id : null;
  };

  const restoreScores = async (columnId, columnScores) => {
    const entries = Object.entries(columnScores || {}).map(([sid, v]) => ({
      column_id: columnId,
      student_id: Number(sid),
      value: v,
    }));
    if (entries.length) {
      await fetch('/api/scores/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
    }
  };

  // --- Mutations (each records an undo/redo history entry) -------------------
  const saveName = async () => {
    setEditingName(false);
    if (name === assessment.name) return;
    const oldName = assessment.name;
    const newName = name;
    await putAssessment({ name: newName });
    onRefresh();
    history?.push({
      label: 'rename assessment',
      undo: async () => { await putAssessment({ name: oldName }); onRefresh(); },
      redo: async () => { await putAssessment({ name: newName }); onRefresh(); },
    });
  };

  const saveWeight = async () => {
    setEditingWeight(false);
    const weightNum = parseFloat(weight);
    const currentWeight = parseFloat(assessment.weight_percent);
    if (Math.abs(weightNum - currentWeight) < 0.001) return;
    const oldWeight = currentWeight;
    const newWeight = Math.round(weightNum * 100) / 100;
    await putAssessment({ weight_percent: newWeight });
    onRefresh();
    history?.push({
      label: 'edit weight',
      undo: async () => { await putAssessment({ weight_percent: oldWeight }); onRefresh(); },
      redo: async () => { await putAssessment({ weight_percent: newWeight }); onRefresh(); },
    });
  };

  const deleteAssessment = async () => {
    // Deep snapshot (columns + their scores + position) so undo can restore
    // the assessment exactly as it was.
    const oldId = assessment.id;
    const snapshot = {
      name: assessment.name,
      is_exam: assessment.is_exam ? 1 : 0,
      weight_percent: assessment.weight_percent,
      order: (periodAssessments || []).map(a => a.id),
      columns: (assessment.columns || []).map(c => ({
        date: toDateInputValue(c.date) || null,
        max_score: c.max_score,
        scores: scores?.[c.id] ? { ...scores[c.id] } : {},
      })),
    };
    await fetch(`/api/assessments/${oldId}`, { method: 'DELETE' });
    refreshAll();

    if (!history) return;
    let currentId = null;
    history.push({
      label: `remove assessment "${assessment.is_exam ? 'Exam' : snapshot.name}"`,
      undo: async () => {
        const res = await fetch(`/api/periods/${periodId}/assessments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: snapshot.name,
            is_exam: snapshot.is_exam,
            weight_percent: snapshot.weight_percent,
            skip_auto_column: true,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!json?.id) { refreshAll(); return; }
        currentId = json.id;
        for (const c of snapshot.columns) {
          const colRes = await fetch(`/api/assessments/${currentId}/columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: c.date, max_score: c.max_score }),
          });
          const colJson = await colRes.json().catch(() => ({}));
          if (colJson?.id) await restoreScores(colJson.id, c.scores);
        }
        // Put the restored assessment back in its original position.
        const ids = snapshot.order.map(x => (x === oldId ? currentId : x));
        await fetch(`/api/assessments/${currentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reorder: true, ids }),
        });
        refreshAll();
      },
      redo: async () => {
        if (currentId) await fetch(`/api/assessments/${currentId}`, { method: 'DELETE' });
        refreshAll();
      },
    });
  };

  const pushAddColumnEntry = (createdId, body) => {
    if (!history || !createdId) return;
    let colId = createdId;
    history.push({
      label: 'add column',
      undo: async () => {
        await fetch(`/api/columns/${colId}`, { method: 'DELETE' });
        refreshAll();
      },
      redo: async () => {
        const newId = await postColumn(body);
        if (newId) colId = newId;
        refreshAll();
      },
    });
  };

  const addColumn = async () => {
    const body = { date: null, max_score: 0 };
    const createdId = await postColumn(body);
    onRefresh();
    pushAddColumnEntry(createdId, body);
  };

  // Create this assessment's first column with the picked date. Used by the
  // clickable "--" placeholder when an assessment (e.g. a legacy Exam) has no
  // date column yet.
  const addColumnWithDate = async (date) => {
    const body = { date, max_score: assessment.is_exam ? 100 : 0 };
    const createdId = await postColumn(body);
    onRefresh();
    pushAddColumnEntry(createdId, body);
  };

  // Commit a date edit. Saves ONLY when the value actually changed, so
  // clicking a date and clicking away never mutates it.
  const commitDate = async (col, inputValue) => {
    setEditingDate(null);
    const prev = toDateInputValue(col.date);
    const next = inputValue || '';
    if (next === prev) return;
    const apply = async (v) => { await putColumn(col.id, { date: v || null }); onRefresh(); };
    await apply(next);
    history?.push({
      label: 'change date',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  };

  // Commit a max-score edit only when the value actually changed.
  const commitMaxScore = async (col, inputValue) => {
    const prev = parseFloat(col.max_score) || 0;
    const next = parseFloat(inputValue) || 0;
    if (Math.abs(next - prev) < 0.001) return;
    const apply = async (v) => { await putColumn(col.id, { max_score: v }); onRefresh(); };
    await apply(next);
    history?.push({
      label: 'change max score',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  };

  const deleteColumn = async (colId) => {
    const col = (assessment.columns || []).find(c => c.id === colId);
    const columnScores = scores?.[colId] ? { ...scores[colId] } : {};
    const body = col
      ? { date: toDateInputValue(col.date) || null, max_score: col.max_score }
      : null;
    await fetch(`/api/columns/${colId}`, { method: 'DELETE' });
    refreshAll();

    if (!history || !body) return;
    let currentId = colId;
    history.push({
      label: 'remove column',
      undo: async () => {
        const newId = await postColumn(body);
        if (newId) {
          currentId = newId;
          await restoreScores(newId, columnScores);
        }
        refreshAll();
      },
      redo: async () => {
        await fetch(`/api/columns/${currentId}`, { method: 'DELETE' });
        refreshAll();
      },
    });
  };

  const handleDeleteColumn = (colId) => {
    setConfirmDeleteColumn(colId);
  };

  const confirmDeleteColumnAction = () => {
    if (confirmDeleteColumn) {
      deleteColumn(confirmDeleteColumn);
      setConfirmDeleteColumn(null);
    }
  };

  if (mode === 'header-name') {
    return (
      <SortableHeaderCell
        id={assessment.id}
        periodId={periodId}
        colSpan={colSpan}
        dragDisabled={editingName || editingWeight || confirmDelete}
        className={`${colors.light} border-r border-b border-gray-200 text-center px-2 py-1.5`}
      >
        <div className="flex items-center justify-center gap-1">
          {assessment.is_exam ? (
            // Exams are always displayed simply as "Exam" — the grading period
            // header already indicates PRELIM / MIDTERM / FINAL.
            <span className={`text-xs font-semibold ${colors.text}`}>Exam</span>
          ) : editingName ? (
            <input
              autoFocus
              className="text-xs px-1 py-0.5 border border-blue-400 rounded w-28 text-center"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => e.key === 'Enter' && saveName()}
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className={`text-xs font-semibold ${colors.text} hover:underline`}
            >
              {assessment.name}
            </button>
          )}

          {editingWeight ? (
            <div className="flex items-center gap-0.5 ml-1">
              <input
                autoFocus
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="text-xs px-1 py-0.5 border border-blue-400 rounded w-12 text-center"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                onBlur={saveWeight}
                onKeyDown={e => e.key === 'Enter' && saveWeight()}
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          ) : (
            <button
              onClick={() => setEditingWeight(true)}
              className="text-xs text-gray-400 hover:text-gray-700 ml-1"
              title="Edit weight"
            >
              ({formatNumber(assessment.weight_percent)}%)
            </button>
          )}

          {!assessment.is_exam && (
            <button
              onClick={addColumn}
              title="Add date column"
              className="ml-1 text-gray-300 hover:text-blue-600 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}

          <button
            onClick={() => setConfirmDelete(true)}
            className="text-gray-200 hover:text-red-500 transition-colors"
            title="Delete assessment"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>


        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteAssessment}
          title="Delete Assessment"
          message={`Delete "${assessment.is_exam ? 'Exam' : assessment.name}"? All scores in this category will be removed.`}
        />
      </SortableHeaderCell>
    );
  }

  if (mode === 'header-dates') {
    if (assessment.columns.length === 0) {
      return (
        <th className="relative border-r border-gray-200 px-0 py-0.5 text-center">
          <span
            className="block text-[9px] text-gray-300 cursor-pointer hover:text-blue-600 py-0.5"
            title="Set date"
            onClick={() => setAddingDate(true)}
          >
            --
          </span>
          {addingDate && (
            <input
              type="date"
              autoFocus
              className="absolute left-0 top-1/2 -translate-y-1/2 z-20 text-[10px] border border-blue-400 bg-white text-center focus:outline-none focus:ring-1 focus:ring-blue-400 py-0.5"
              style={{ width: '110px' }}
              onFocus={e => { try { e.target.showPicker?.(); } catch {} }}
              onBlur={e => {
                const v = e.target.value;
                setAddingDate(false);
                if (v) addColumnWithDate(v);
              }}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
            />
          )}
        </th>
      );
    }

    return (
      <>
        {assessment.columns.map(col => (
          <th key={col.id} className="group relative border-r border-gray-200 px-0 py-0.5 text-center">
            <span
              className="block text-[9px] cursor-pointer hover:text-blue-600 py-0.5 truncate"
              onClick={() => setEditingDate(col.id)}
              title={formatDateMMDDYYYY(col.date)}
            >
              {formatDateMMDDYYYY(col.date)}
            </span>
            {editingDate === col.id && (
              <input
                type="date"
                autoFocus
                className="absolute left-0 top-1/2 -translate-y-1/2 z-20 text-[10px] border border-blue-400 bg-white text-center focus:outline-none focus:ring-1 focus:ring-blue-400 py-0.5"
                style={{ width: '110px' }}
                defaultValue={toDateInputValue(col.date)}
                onFocus={e => { try { e.target.showPicker?.(); } catch {} }}
                onBlur={e => commitDate(col, e.target.value)}
                onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              />
            )}
            {!assessment.is_exam && (
              <button
                onClick={() => handleDeleteColumn(col.id)}
                className="absolute right-0 top-1/2 -translate-y-1/2 hidden group-hover:block bg-white/95 rounded-sm p-0.5 text-gray-300 hover:text-red-500 transition-colors"
                title="Remove column"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            )}
          </th>
        ))}
        <ConfirmDialog
          open={confirmDeleteColumn !== null}
          onClose={() => setConfirmDeleteColumn(null)}
          onConfirm={confirmDeleteColumnAction}
          title="Delete Column"
          message="Delete this assessment column? All scores in this column will be removed."
        />
      </>
    );
  }

  if (mode === 'header-max-scores') {
    if (assessment.columns.length === 0) {
      return (
        <th className="border-r border-gray-200 px-0 py-0.5 text-center">
          <span className="block text-[9px] text-gray-300 py-0.5">--</span>
        </th>
      );
    }

    return (
      <>
        {assessment.columns.map(col => (
          <th key={col.id} className="border-r border-gray-200 px-0 py-0.5 text-center">
            <input
              type="number"
              min="0"
              defaultValue={formatNumber(col.max_score)}
              onBlur={e => commitMaxScore(col, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              className="w-full text-center text-[10px] border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 py-0.5"
              title="Max score"
            />
          </th>
        ))}
      </>
    );
  }

  return null;
}
