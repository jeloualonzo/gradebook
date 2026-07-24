'use client';
import { useState, useRef, memo } from 'react';
import ConfirmDialog from './ConfirmDialog';
import MoveColumnDialog from './MoveColumnDialog';
import { formatNumber, toCents, centsToNumber } from '@/lib/gradeCalculator';
import { toDateInputValue, formatDateMMDDYYYY, formatDateLong } from '@/lib/dateUtils';
import { columnCodeInfo } from '@/lib/shortCodes';
import { isWorkspace, aggMethodLabel } from '@/lib/workspace';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Sortable <th> wrapper for the assessment name header cell. Dragging this
 * block reorders the assessment within its own grading period.
 */
function SortableHeaderCell({ id, periodId, colSpan, className, dragDisabled, onContextMenu, children }) {
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
      onContextMenu={onContextMenu}
      className={`${className} ${isDragging ? 'opacity-60 ring-2 ring-blue-400 relative z-30' : dragDisabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      {...attributes}
      {...(dragDisabled ? {} : listeners)}
    >
      {children}
    </th>
  );
}

function AssessmentBlock({
  assessment,
  periodId,
  periodType,
  subjectId,
  colors,
  mode,
  onRefresh,
  onRefreshData,
  onPatchAssessment,
  onPatchColumn,
  getScores,
  getPeriodOrder,
  onHistoryPush,
  onSaveError,
  onOpenMenu,
  onFocusColumn,
  onNotify,
  columnNotes,        // { [columnId]: body } — alive column notes (v1.8.0)
  onEditColumnNote,   // (columnId) => void — opens the note editor
  onDeleteColumnNote, // (columnId) => void — deletes with undo + toast
  onOpenWorkspace,    // (assessmentId) => void — navigates to the workspace (v1.9.0)
  codesOn,            // whether the short-code header row is shown (rowSpan math)
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(assessment.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingDate, setAddingDate] = useState(false);
  const [editingWeight, setEditingWeight] = useState(false);
  const [weight, setWeight] = useState(assessment.weight_percent);
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState(null);
  const [editingDate, setEditingDate] = useState(null);
  const [editingCode, setEditingCode] = useState(null);
  const [movingColumn, setMovingColumn] = useState(null);
  // Set when Escape cancels a date/code edit, so the blur commit is skipped.
  const dateCancelRef = useRef(false);
  const codeCancelRef = useRef(false);

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

  // Workspace assessments occupy exactly ONE grid column (the computed one),
  // however many detail columns live behind their workspace.
  const workspace = isWorkspace(assessment);
  const colSpan = workspace ? 1 : Math.max(assessment.columns.length, 1);

  // Refresh periods AND scores when an operation may touch score data.
  const refreshAll = () => (onRefreshData ? onRefreshData() : onRefresh());

  // --- Low-level API helpers (throw on failure so callers can roll back) ----
  const putAssessment = async (body) => {
    const res = await fetch(`/api/assessments/${assessment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Save failed');
  };

  const putColumn = async (colId, body) => {
    const res = await fetch(`/api/columns/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Save failed');
    return res.json().catch(() => ({}));
  };

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
      student_id: sid, // ids are UUID strings
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

  // --- Mutations --------------------------------------------------------------
  // Value edits are OPTIMISTIC: patch local state instantly, save in the
  // background, and roll back (with an error toast) if the save fails.
  // No full gradebook refetch happens for simple value edits.

  const saveName = async () => {
    setEditingName(false);
    const newName = name.trim();
    const oldName = assessment.name;
    if (!newName || newName === oldName) {
      setName(oldName);
      return;
    }
    onPatchAssessment(assessment.id, { name: newName }); // instant UI
    try {
      await putAssessment({ name: newName }); // silent background save
    } catch {
      onPatchAssessment(assessment.id, { name: oldName }); // rollback
      onSaveError?.('Could not save the assessment name — value restored.');
      return;
    }
    onHistoryPush?.({
      label: 'rename assessment',
      undo: async () => { onPatchAssessment(assessment.id, { name: oldName }); await putAssessment({ name: oldName }); },
      redo: async () => { onPatchAssessment(assessment.id, { name: newName }); await putAssessment({ name: newName }); },
    });
  };

  const saveWeight = async () => {
    setEditingWeight(false);
    // Integer-cents comparison and normalization — the entered value is
    // preserved exactly (no floating-point drift like 39.99).
    const newCents = toCents(weight);
    const oldCents = toCents(assessment.weight_percent);
    if (newCents === oldCents) {
      setWeight(assessment.weight_percent);
      return;
    }
    const oldWeight = centsToNumber(oldCents);
    const newWeight = centsToNumber(newCents);
    onPatchAssessment(assessment.id, { weight_percent: newWeight }); // instant UI
    try {
      await putAssessment({ weight_percent: newWeight });
    } catch {
      onPatchAssessment(assessment.id, { weight_percent: oldWeight });
      onSaveError?.('Could not save the weight — value restored.');
      return;
    }
    onHistoryPush?.({
      label: 'edit weight',
      undo: async () => { onPatchAssessment(assessment.id, { weight_percent: oldWeight }); await putAssessment({ weight_percent: oldWeight }); },
      redo: async () => { onPatchAssessment(assessment.id, { weight_percent: newWeight }); await putAssessment({ weight_percent: newWeight }); },
    });
  };

  const deleteAssessment = async () => {
    // Deep snapshot (columns + their scores + position) so undo can restore
    // the assessment exactly as it was.
    const oldId = assessment.id;
    const allScores = getScores?.() || {};
    const snapshot = {
      name: assessment.name,
      is_exam: assessment.is_exam ? 1 : 0,
      weight_percent: assessment.weight_percent,
      order: getPeriodOrder ? getPeriodOrder(periodId) : [],
      columns: (assessment.columns || []).map(c => ({
        date: toDateInputValue(c.date) || null,
        max_score: c.max_score,
        scores: allScores?.[c.id] ? { ...allScores[c.id] } : {},
      })),
    };
    await fetch(`/api/assessments/${oldId}`, { method: 'DELETE' });
    refreshAll();

    if (!onHistoryPush) return;
    let currentId = null;
    onHistoryPush({
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
    if (!onHistoryPush || !createdId) return;
    let colId = createdId;
    onHistoryPush({
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
  // clicking a date and clicking away never mutates it. Optimistic:
  // the new date shows instantly; the save happens silently in the background.
  const commitDate = async (col, inputValue) => {
    setEditingDate(null);
    // Escape pressed: exit edit mode without saving anything.
    if (dateCancelRef.current) {
      dateCancelRef.current = false;
      return;
    }
    const prev = toDateInputValue(col.date);
    const next = inputValue || '';
    if (next === prev) return;
    const apply = (v) => onPatchColumn(col.id, { date: v || null });
    apply(next); // instant UI
    try {
      await putColumn(col.id, { date: next || null });
    } catch {
      apply(prev);
      onSaveError?.('Could not save the date — value restored.');
      return;
    }
    onHistoryPush?.({
      label: 'change date',
      undo: async () => { apply(prev); await putColumn(col.id, { date: prev || null }); },
      redo: async () => { apply(next); await putColumn(col.id, { date: next || null }); },
    });
  };

  // Commit a max-score edit only when the value actually changed (cents-exact).
  const commitMaxScore = async (col, inputValue) => {
    const newCents = toCents(inputValue);
    const oldCents = toCents(col.max_score);
    if (newCents === oldCents) return;
    const oldVal = centsToNumber(oldCents);
    const newVal = centsToNumber(newCents);
    const apply = (v) => onPatchColumn(col.id, { max_score: v });
    apply(newVal); // instant UI
    try {
      await putColumn(col.id, { max_score: newVal });
    } catch {
      apply(oldVal);
      onSaveError?.('Could not save the max score — value restored.');
      return;
    }
    onHistoryPush?.({
      label: 'change max score',
      undo: async () => { apply(oldVal); await putColumn(col.id, { max_score: oldVal }); },
      redo: async () => { apply(newVal); await putColumn(col.id, { max_score: newVal }); },
    });
  };

  const deleteColumn = async (colId) => {
    const col = (assessment.columns || []).find(c => c.id === colId);
    const allScores = getScores?.() || {};
    const columnScores = allScores?.[colId] ? { ...allScores[colId] } : {};
    const body = col
      ? { date: toDateInputValue(col.date) || null, max_score: col.max_score }
      : null;
    await fetch(`/api/columns/${colId}`, { method: 'DELETE' });
    refreshAll();

    if (!onHistoryPush || !body) return;
    let currentId = colId;
    onHistoryPush({
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

  // Right-click menu for the assessment header — replaces the old +/trash icons.
  const assessmentMenuItems = () => [
    // Workspace assessments manage their details in the workspace, never
    // through grid columns.
    workspace && { label: 'Open workspace…', onClick: () => onOpenWorkspace?.(assessment.id) },
    !assessment.is_exam && !workspace && { label: 'Add date column', onClick: addColumn },
    !assessment.is_exam && { label: 'Rename assessment…', separatorBefore: workspace, onClick: () => setEditingName(true) },
    { label: 'Edit weight…', onClick: () => setEditingWeight(true) },
    { label: 'Delete assessment…', danger: true, separatorBefore: true, onClick: () => setConfirmDelete(true) },
  ];

  if (mode === 'header-name') {
    return (
      <SortableHeaderCell
        id={assessment.id}
        periodId={periodId}
        colSpan={colSpan}
        // The Exam is permanently the last assessment — it cannot be dragged.
        // Projected term-span copies belong to ANOTHER period's ordering and
        // cannot be dragged either (their placement is by projection rule).
        dragDisabled={!!assessment.is_exam || !!assessment.projected || editingName || editingWeight || confirmDelete}
        onContextMenu={e => onOpenMenu?.(e, assessmentMenuItems())}
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
              // Also reachable via F2 from any cell of this assessment's
              // columns (GradebookTable clicks this button for you).
              data-rename-assessment={assessment.id}
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

  // Marking a date as an "attendance source": entering a score on it
  // automatically marks the student Present in Attendance for the same date.
  const toggleAttendanceSource = async (col) => {
    const next = col.attendance_source ? 0 : 1;
    const apply = (v) => onPatchColumn(col.id, { attendance_source: v });
    apply(next); // instant UI
    let saved;
    try {
      saved = await putColumn(col.id, { attendance_source: next });
    } catch {
      apply(col.attendance_source ? 1 : 0);
      onSaveError?.('Could not save the attendance setting — value restored.');
      return;
    }
    // Retroactive backfill (v1.7.1): enabling the flag processed the
    // column's EXISTING scores server-side — surface what happened and pull
    // the fresh attendance rows into the grid.
    if (next && saved?.attendance_backfilled > 0) {
      onNotify?.(`Marked ${saved.attendance_backfilled} student${saved.attendance_backfilled === 1 ? '' : 's'} Present for ${formatDateLong(col.date)}`);
      onRefreshData?.();
    }
    onHistoryPush?.({
      label: next ? 'count date as attendance' : 'stop counting date as attendance',
      // Undoing the toggle flips the FLAG only — attendance already written
      // (manual or backfilled) persists, per the add-only mirroring rule.
      undo: async () => { apply(next ? 0 : 1); await putColumn(col.id, { attendance_source: next ? 0 : 1 }); },
      redo: async () => { apply(next); await putColumn(col.id, { attendance_source: next }); },
    });
  };

  const isAttendanceAssessment = String(assessment.name || '').toLowerCase() === 'attendance';

  // Right-click menu for one date column. "Edit max score" focuses the max
  // input in the row below (located via its data attribute).
  const columnMenuItems = (col) => [
    // Focused grading (v1.7.0): one column, every student, zero horizontal
    // scrolling — the same editing cells as the grid, in a floating view.
    { label: 'Focus assessment…', onClick: () => onFocusColumn?.(col.id) },
    { label: 'Edit date…', separatorBefore: true, onClick: () => setEditingDate(col.id) },
    {
      label: 'Edit max score…',
      onClick: () => {
        const input = document.querySelector(`input[data-max-for="${col.id}"]`);
        if (input) { input.focus(); input.select?.(); }
      },
    },
    // Free-form note on this date (v1.8.0) — synced, Excel-comment style.
    !!onEditColumnNote && {
      label: columnNotes?.[col.id] ? 'Edit note…' : 'Add note…',
      onClick: () => onEditColumnNote(col.id),
    },
    !!onDeleteColumnNote && !!columnNotes?.[col.id] && {
      label: 'Delete note',
      onClick: () => onDeleteColumnNote(col.id),
    },
    // Attendance source toggle: only meaningful for dated, non-exam columns
    // of ordinary assessments (Attendance itself can't feed Attendance).
    !assessment.is_exam && !isAttendanceAssessment && !!col.date && {
      label: col.attendance_source ? 'Counts as attendance ✓' : 'Count as attendance',
      onClick: () => toggleAttendanceSource(col),
    },
    // Exams keep exactly one date column — moving/deleting is for the rest.
    !assessment.is_exam && {
      label: 'Move to another subject…',
      separatorBefore: true,
      onClick: () => setMovingColumn(col),
    },
    !assessment.is_exam && {
      label: 'Delete date column…',
      danger: true,
      onClick: () => handleDeleteColumn(col.id),
    },
  ];

  if (mode === 'header-dates') {
    // Workspace assessments: ONE quiet cell spanning the dates/codes/max
    // rows — the doorway to the workspace, plus the configuration at a
    // glance. Live completion counts stay in the stats footer and the
    // workspace itself (a static header keeps the memoization contract).
    if (workspace) {
      const cfg = assessment.span === 'term'
        ? 'whole term'
        : `${aggMethodLabel(assessment.agg_method).toLowerCase()}${assessment.agg_max ? ` · /${formatNumber(assessment.agg_max)}` : ''}`;
      return (
        <th
          data-col-head={`ws-${assessment.id}`}
          rowSpan={codesOn ? 3 : 2}
          className="relative border-r border-gray-200 px-1 py-0.5 text-center align-middle"
          onContextMenu={e => onOpenMenu?.(e, assessmentMenuItems())}
        >
          <button
            onClick={() => onOpenWorkspace?.(assessment.id)}
            className="block w-full text-[9px] text-blue-600 hover:text-blue-800 hover:underline py-0.5 truncate"
            title={`Open the ${assessment.name} workspace — ${cfg}`}
          >
            workspace ↗
          </button>
          <span className="block text-[8.5px] text-gray-400 truncate" title={cfg}>{cfg}</span>
        </th>
      );
    }
    if (assessment.columns.length === 0) {
      return (
        <th
          className="relative border-r border-gray-200 px-1 py-0.5 text-center"
          onContextMenu={e => onOpenMenu?.(e, [{ label: 'Set date…', onClick: () => setAddingDate(true) }])}
        >
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
                if (dateCancelRef.current) {
                  dateCancelRef.current = false;
                  return;
                }
                if (v) addColumnWithDate(v);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.target.blur();
                else if (e.key === 'Escape') {
                  e.preventDefault();
                  dateCancelRef.current = true;
                  e.target.blur();
                }
              }}
            />
          )}
        </th>
      );
    }

    return (
      <>
        {assessment.columns.map(col => (
          <th
            key={col.id}
            data-col-head={col.id}
            className="relative border-r border-gray-200 px-1 py-0.5 text-center"
            onContextMenu={e => onOpenMenu?.(e, columnMenuItems(col))}
          >
            <span
              className="block text-[9px] cursor-pointer hover:text-blue-600 py-0.5 truncate"
              onClick={() => setEditingDate(col.id)}
              // The note reads on hover, exactly like an Excel comment.
              title={`${formatDateMMDDYYYY(col.date)}${col.attendance_source ? ' — counts as attendance' : ''}${columnNotes?.[col.id] ? `\n\n${columnNotes[col.id]}` : ''}`}
            >
              {!!col.attendance_source && <span className="text-green-600 font-bold">✓</span>}
              {formatDateMMDDYYYY(col.date)}
            </span>
            {!!columnNotes?.[col.id] && <span className="gb-note-dot" aria-hidden="true" />}
            {editingDate === col.id && (
              <input
                type="date"
                autoFocus
                className="absolute left-0 top-1/2 -translate-y-1/2 z-20 text-[10px] border border-blue-400 bg-white text-center focus:outline-none focus:ring-1 focus:ring-blue-400 py-0.5"
                style={{ width: '110px' }}
                defaultValue={toDateInputValue(col.date)}
                onFocus={e => { try { e.target.showPicker?.(); } catch {} }}
                onBlur={e => commitDate(col, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  else if (e.key === 'Escape') {
                    // Cancel: exit without saving (blur commit is skipped).
                    e.preventDefault();
                    dateCancelRef.current = true;
                    e.target.blur();
                  }
                }}
              />
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
        <MoveColumnDialog
          open={movingColumn !== null}
          onClose={() => setMovingColumn(null)}
          column={movingColumn}
          assessmentName={assessment.name}
          sourceSubjectId={subjectId}
          sourcePeriodType={periodType}
          onMoved={() => refreshAll()}
        />
      </>
    );
  }

  // Commit a short-code edit (v1.9.0). The label field stores MANUAL names
  // only: typing the automatic code back (or clearing) saves '' — the column
  // returns to automatic sequencing; anything else is preserved forever.
  const commitCodeLabel = async (col, autoCode, inputValue) => {
    setEditingCode(null);
    if (codeCancelRef.current) {
      codeCancelRef.current = false;
      return;
    }
    const prev = String(col.label || '').trim();
    let next = String(inputValue || '').trim();
    if (next === autoCode) next = ''; // the automatic value is never frozen
    if (next === prev) return;
    const apply = (v) => onPatchColumn(col.id, { label: v });
    apply(next); // instant UI
    try {
      await putColumn(col.id, { label: next });
    } catch {
      apply(prev);
      onSaveError?.('Could not save the column name — value restored.');
      return;
    }
    onHistoryPush?.({
      label: 'rename column',
      undo: async () => { apply(prev); await putColumn(col.id, { label: prev }); },
      redo: async () => { apply(next); await putColumn(col.id, { label: next }); },
    });
  };

  // Short-code row (v1.9.0, redesigned): EXACTLY the dates row's presentation
  // and editing pattern — same th classes, same span typography, same
  // click-to-edit → blur-commit → Escape-cancel lifecycle. The tooltip shows
  // the actual assessment name ("Quiz 3"), never the word "automatic".
  if (mode === 'header-codes') {
    if (workspace) return null; // covered by the dates-row cell's rowSpan
    if (assessment.columns.length === 0) {
      return (
        <th className="relative border-r border-gray-200 px-1 py-0.5 text-center">
          <span className="block text-[9px] text-gray-300 py-0.5">--</span>
        </th>
      );
    }
    const info = columnCodeInfo(assessment);
    return (
      <>
        {assessment.columns.map((col, i) => (
          <th
            key={col.id}
            data-col-head={col.id}
            className="relative border-r border-gray-200 px-1 py-0.5 text-center"
            // This instance's menu offers only actions that WORK from this
            // row; structural operations live on the dates/max rows.
            onContextMenu={e => onOpenMenu?.(e, [
              { label: 'Rename column…', onClick: () => setEditingCode(col.id) },
              { label: 'Focus assessment…', onClick: () => onFocusColumn?.(col.id) },
            ])}
          >
            <span
              className="block text-[9px] cursor-pointer hover:text-blue-600 py-0.5 truncate"
              onClick={() => setEditingCode(col.id)}
              title={info[i].manual ? `${info[i].code} — ${info[i].long}` : info[i].long}
            >
              {info[i].code}
            </span>
            {editingCode === col.id && (
              <input
                type="text"
                autoFocus
                maxLength={24}
                className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-20 text-[10px] border border-blue-400 bg-white text-center focus:outline-none focus:ring-1 focus:ring-blue-400 py-0.5"
                style={{ width: '64px' }}
                defaultValue={info[i].code}
                onFocus={e => e.target.select()}
                onBlur={e => commitCodeLabel(col, info[i].auto, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  else if (e.key === 'Escape') {
                    e.preventDefault();
                    codeCancelRef.current = true;
                    e.target.blur();
                  }
                }}
              />
            )}
          </th>
        ))}
      </>
    );
  }

  if (mode === 'header-max-scores') {
    if (workspace) return null; // covered by the dates-row cell's rowSpan
    if (assessment.columns.length === 0) {
      return (
        <th className="border-r border-gray-200 px-1 py-0.5 text-center">
          <span className="block text-[9px] text-gray-300 py-0.5">--</span>
        </th>
      );
    }

    return (
      <>
        {assessment.columns.map(col => (
          <th
            key={col.id}
            data-col-head={col.id}
            className="border-r border-gray-200 px-1 py-0.5 text-center"
            onContextMenu={e => onOpenMenu?.(e, columnMenuItems(col))}
          >
            <input
              // Remount when the stored value changes (rollback / undo / redo)
              // so this uncontrolled input always shows the current value.
              key={`${col.id}-${formatNumber(col.max_score)}`}
              type="number"
              min="0"
              defaultValue={formatNumber(col.max_score)}
              data-cell="max"
              data-max-for={col.id}
              onFocus={e => e.target.select()}
              onBlur={e => commitMaxScore(col, e.target.value)}
              onKeyDown={e => {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                const focusCell = (el) => { if (el) { el.focus(); el.select?.(); } };
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  // Commit (via blur) and move down into the first student row.
                  e.preventDefault();
                  focusCell(document.querySelector(`input[data-cell="score"][data-col="${col.id}"]`));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault(); // just stop the number spinner
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const cells = Array.from(document.querySelectorAll('input[data-cell="max"]'));
                  focusCell(cells[cells.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1)]);
                } else if (e.key === 'Escape') {
                  // Cancel: restore the stored value, then exit (no save —
                  // the blur commit sees an unchanged value).
                  e.preventDefault();
                  e.target.value = formatNumber(col.max_score);
                  e.target.blur();
                }
              }}
              className="w-full text-center text-[10px] border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 py-0.5"
              title="Max score"
            />
          </th>
        ))}
        <ConfirmDialog
          open={confirmDeleteColumn !== null}
          onClose={() => setConfirmDeleteColumn(null)}
          onConfirm={confirmDeleteColumnAction}
          title="Delete Column"
          message="Delete this assessment column? All scores in this column will be removed."
        />
        <MoveColumnDialog
          open={movingColumn !== null}
          onClose={() => setMovingColumn(null)}
          column={movingColumn}
          assessmentName={assessment.name}
          sourceSubjectId={subjectId}
          sourcePeriodType={periodType}
          onMoved={() => refreshAll()}
        />
      </>
    );
  }

  return null;
}

// Memoized: with stable callback props from the page, an edit to one
// assessment re-renders only that assessment's header cells — not the
// hundreds of others.
export default memo(AssessmentBlock);
