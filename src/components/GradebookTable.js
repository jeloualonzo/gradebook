'use client';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import React from 'react';
import ScoreCell from './ScoreCell';
import ContextMenu from './ContextMenu';
import FindStudentBar from './FindStudentBar';
import GridSelectionLayer from './GridSelectionLayer';
import ConfirmDialog from './ConfirmDialog';
import { missingCounts, columnStats, blankEntries } from '@/lib/classStats';
import { formatGrade, formatNumber, toCents, computePeriodGrade, computeFinalSubjectGrade } from '@/lib/gradeCalculator';
import { displayName } from '@/lib/names';
import AssessmentBlock from './AssessmentBlock';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  ASSESSMENT_COL_WIDTH_PX,
  GRADE_COL_WIDTH_PX,
  FINAL_GRADE_COL_WIDTH_PX,
  NUM_COL_WIDTH_PX,
  NAME_COL_WIDTH_PX,
  NAME_COL_MIN_PX,
  NAME_COL_MAX_PX,
  STICKY_SCROLLBAR_WIDTH_PX,
} from '@/lib/uiConfig';

// Persisted user preference: the Student Name column's width.
const NAME_WIDTH_KEY = 'gb-name-col-width';
const clampNameWidth = (w) => Math.min(NAME_COL_MAX_PX, Math.max(NAME_COL_MIN_PX, Math.round(w)));

const PERIOD_COLORS = {
  PRELIM: { header: 'bg-blue-700', light: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  MIDTERM: { header: 'bg-green-700', light: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
  // Purple (not red/orange) — red implies errors; purple stays distinct from
  // the blue/green periods while reading as "final".
  FINAL: { header: 'bg-purple-700', light: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
};

const STICKY_NO = 'sticky-col';
const STICKY_NAME = 'sticky-col-2';

/**
 * One primitive for every range mutation (batch 2a ships clear; fill and
 * paste will reuse it): ONE transactional bulk write, ONE shared-map commit,
 * ONE undo entry carrying bulk images in both directions. Module-scope so
 * the undo/redo closures can re-enter it freely; the v1.0.9 write guards
 * make re-applying identical values a true server-side no-op.
 */
async function applyBulkWrite({ entries, label, record = true, getScores, onBulkUpdate, onHistoryPush, onSaveError, onAttendanceApplied }) {
  const scoresNow = getScores?.() || {};
  const before = entries.map(e => {
    const v = scoresNow?.[e.column_id]?.[e.student_id];
    return { column_id: e.column_id, student_id: e.student_id, value: v === undefined || v === '' ? null : v };
  });
  const res = await fetch('/api/scores/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) {
    onSaveError?.('Could not apply the change — nothing was modified.');
    return false;
  }
  onBulkUpdate?.(entries);
  // Attendance-source parity: mirror any auto-Present marks live, exactly
  // like a typed score does (the route returns the applications).
  try {
    const json = await res.json();
    for (const app of json?.attendance || []) {
      if (app?.applied) onAttendanceApplied?.(app);
    }
  } catch { /* body is a convenience — the write itself succeeded */ }
  if (record && onHistoryPush) {
    const shared = { getScores, onBulkUpdate, onHistoryPush, onSaveError, onAttendanceApplied, record: false, label };
    onHistoryPush({
      label,
      undo: () => applyBulkWrite({ ...shared, entries: before }),
      redo: () => applyBulkWrite({ ...shared, entries }),
    });
  }
  return true;
}

export default function GradebookTable({
  subject,
  periods,
  students,
  scores,
  onVisiblePeriodChange,
  onUpdateScore,
  onBulkUpdate,
  showStats,
  showMissingHighlight,
  rosterNumbers,
  onFocusColumn,
  onNotify,
  onAttendanceApplied,
  onRefreshPeriods,
  onRefreshData,
  onReorderLocal,
  onPatchAssessment,
  onPatchColumn,
  getScores,
  getPeriodOrder,
  onHistoryPush,
  onSaveError,
  onEditStudent,
  onDeleteStudent,
  onAddToGroup,
  onStudentFocus,
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [addingAssessment, setAddingAssessment] = useState(null);
  const [newAssessmentName, setNewAssessmentName] = useState('');

  // One context menu for the whole grid (portaled to <body>).
  // While a menu is open, the row it came from stays marked (v1.7.0) — a
  // distinct tint from hover, so "whose menu is this?" is always answered.
  // Imperative class toggling, like every other transient grid highlight.
  const [menu, setMenu] = useState(null);
  const menuRowRef = useRef(null);
  const clearMenuRow = useCallback(() => {
    menuRowRef.current?.classList.remove('gb-menu-row');
    menuRowRef.current = null;
  }, []);
  const openMenu = useCallback((event, items) => {
    event.preventDefault();
    clearMenuRow();
    const tr = event.target?.closest?.('tr[data-student-row]');
    if (tr) {
      tr.classList.add('gb-menu-row');
      menuRowRef.current = tr;
    }
    setMenu({ x: event.clientX, y: event.clientY, items });
  }, [clearMenuRow]);
  const closeMenu = useCallback(() => {
    clearMenuRow();
    setMenu(null);
  }, [clearMenuRow]);

  // --- Active-column indication ---------------------------------------------
  // When a cell of an assessment column is FOCUSED (score / date / max), that
  // column's Date + Max header cells get the .col-active class. Done with
  // direct DOM class toggling (like the keyboard navigation) so a focus move
  // never re-renders the memoized grid.
  const gridRef = useRef(null);
  const markActiveColumn = useCallback((colId) => {
    const root = gridRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll('th.col-active')) el.classList.remove('col-active');
    if (colId) {
      for (const el of root.querySelectorAll(`th[data-col-head="${colId}"]`)) el.classList.add('col-active');
    }
  }, []);
  const handleGridFocus = useCallback((e) => {
    // Score inputs carry data-col; date/max header cells carry data-col-head.
    const holder = e.target.closest?.('[data-col], [data-col-head]');
    markActiveColumn(holder?.getAttribute('data-col') || holder?.getAttribute('data-col-head') || null);
  }, [markActiveColumn]);
  const handleGridBlur = useCallback(() => {
    // Clear only when focus truly left the grid (moving between cells fires
    // a focus event right after this, which re-marks the new column).
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!gridRef.current || !active || !gridRef.current.contains(active)) markActiveColumn(null);
    });
  }, [markActiveColumn]);

  // --- Resizable Student Name column (Excel-style, persisted) ---------------
  const [nameColWidth, setNameColWidth] = useState(() => {
    if (typeof window === 'undefined') return NAME_COL_WIDTH_PX;
    const saved = parseInt(window.localStorage.getItem(NAME_WIDTH_KEY), 10);
    return Number.isFinite(saved) ? clampNameWidth(saved) : NAME_COL_WIDTH_PX;
  });
  const startNameResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = nameColWidth;
    const move = (ev) => setNameColWidth(clampNameWidth(startW + (ev.clientX - startX)));
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.localStorage.setItem(NAME_WIDTH_KEY, String(clampNameWidth(startW + (ev.clientX - startX))));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Double-click the divider: auto-fit to the longest student name.
  const autoFitNameColumn = () => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '500 12px "Segoe UI", Inter, system-ui, sans-serif'; // matches the name cells
    let max = 0;
    for (const s of students) max = Math.max(max, ctx.measureText(displayName(s)).width);
    const w = clampNameWidth(Math.ceil(max) + 34); // cell padding + breathing room
    setNameColWidth(w);
    window.localStorage.setItem(NAME_WIDTH_KEY, String(w));
  };

  // --- Sticky horizontal scrollbar (proxy synced with the grid) --------------
  const proxyRef = useRef(null);
  const syncingScroll = useRef(false);
  const [proxyState, setProxyState] = useState({ w: 0, visible: false });
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const ro = new ResizeObserver(() => {
      // Native-proportional thumb (v1.7.0): a scrollbar thumb's size is
      // track × (viewport ÷ content). The proxy is a REAL scrollbar, so we
      // get that ratio by sizing its inner spacer to
      // track × (content ÷ viewport) — the thumb then represents exactly
      // what a native Windows scrollbar would show.
      const track = proxyRef.current?.clientWidth || STICKY_SCROLLBAR_WIDTH_PX;
      const ratio = grid.clientWidth > 0 ? grid.scrollWidth / grid.clientWidth : 1;
      setProxyState({ w: Math.round(track * ratio), visible: grid.scrollWidth > grid.clientWidth + 2 });
    });
    ro.observe(grid);
    const table = grid.querySelector('table');
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, []);
  // --- Session restore + live period reporting (ROADMAP Phase 1) ------------
  // Both are scroll-derived: the horizontal position is persisted per subject
  // (device-local, like the name-column width) and the leftmost visible
  // grading period is reported up for the window title. rAF-coalesced so a
  // scroll never does more than one pass of work per frame.
  const scrollFrame = useRef(null);
  const scrollSaveTimer = useRef(null);
  const lastReportedPeriod = useRef(null);
  const restoredForSubject = useRef(null);
  const scrollKey = `gb-scroll-${subject.id}`;

  const reportVisiblePeriod = useCallback(() => {
    const g = gridRef.current;
    if (!g || !onVisiblePeriodChange) return;
    // The period under the first column right of the sticky # + Name pane.
    const x = g.scrollLeft + NUM_COL_WIDTH_PX + nameColWidth + 8;
    let current = null;
    for (const p of periods) {
      const head = g.querySelector(`th[data-period-head="${p.id}"]`);
      if (head && head.offsetLeft <= x) current = p.type;
    }
    if (current && current !== lastReportedPeriod.current) {
      lastReportedPeriod.current = current;
      onVisiblePeriodChange(current);
    }
  }, [periods, nameColWidth, onVisiblePeriodChange]);

  const scheduleScrollWork = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      reportVisiblePeriod();
      clearTimeout(scrollSaveTimer.current);
      scrollSaveTimer.current = setTimeout(() => {
        const g = gridRef.current;
        if (!g) return;
        try {
          window.localStorage.setItem(scrollKey, JSON.stringify({ x: g.scrollLeft, y: window.scrollY }));
        } catch { /* persistence is a convenience */ }
      }, 400);
    });
  }, [reportVisiblePeriod, scrollKey]);

  // Restore once per subject, after the grid has real content to scroll to.
  useEffect(() => {
    if (restoredForSubject.current === subject.id || students.length === 0) return;
    restoredForSubject.current = subject.id;
    let saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(scrollKey) || 'null'); } catch { /* corrupt — ignore */ }
    requestAnimationFrame(() => {
      const g = gridRef.current;
      if (g && saved) {
        g.scrollLeft = saved.x || 0;
        window.scrollTo(0, saved.y || 0);
      }
      reportVisiblePeriod(); // title reflects wherever we landed
    });
  }, [subject.id, students.length, scrollKey, reportVisiblePeriod]);

  // Vertical scrolling happens on the page, not the grid — track it too.
  useEffect(() => {
    window.addEventListener('scroll', scheduleScrollWork, { passive: true });
    return () => window.removeEventListener('scroll', scheduleScrollWork);
  }, [scheduleScrollWork]);

  const onGridScroll = () => {
    scheduleScrollWork();
    if (syncingScroll.current) { syncingScroll.current = false; return; }
    const g = gridRef.current, p = proxyRef.current;
    if (!g || !p) return;
    const gMax = g.scrollWidth - g.clientWidth;
    const pMax = p.scrollWidth - p.clientWidth;
    if (gMax > 0 && pMax > 0) { syncingScroll.current = true; p.scrollLeft = (g.scrollLeft / gMax) * pMax; }
  };
  const onProxyScroll = () => {
    if (syncingScroll.current) { syncingScroll.current = false; return; }
    const g = gridRef.current, p = proxyRef.current;
    if (!g || !p) return;
    const gMax = g.scrollWidth - g.clientWidth;
    const pMax = p.scrollWidth - p.clientWidth;
    if (gMax > 0 && pMax > 0) { syncingScroll.current = true; g.scrollLeft = (p.scrollLeft / pMax) * gMax; }
  };

  // One-click period navigation (the PRELIM/MIDTERM/FINAL buttons docked to
  // the sticky scrollbar): scroll the grid so the period's first column
  // lands just right of the sticky # + Name columns.
  const jumpToPeriod = (periodId) => {
    const grid = gridRef.current;
    const head = grid?.querySelector(`th[data-period-head="${periodId}"]`);
    if (!grid || !head) return;
    const left = Math.max(0, head.offsetLeft - NUM_COL_WIDTH_PX - nameColWidth);
    grid.scrollTo({ left, behavior: 'smooth' });
  };

  // --- F2: rename the assessment you're in ------------------------------------
  // Windows-Explorer convention. With focus in any of a column's cells
  // (score or max), F2 opens that assessment's name editor — the same code
  // path as clicking the name. The Exam's name is fixed, so F2 is a no-op there.
  const colToAssessment = useMemo(() => {
    const m = new Map();
    for (const period of periods) {
      for (const a of period.assessments) {
        for (const c of a.columns) m.set(String(c.id), a);
      }
    }
    return m;
  }, [periods]);
  // --- Selection engine (ROADMAP Phase 2) ------------------------------------
  // Geometry: the grid as the selection model sees it — visible column order
  // and roster row order. Rebuilt only on structural change; the model
  // collapses any active range when the signature shifts.
  const geometry = useMemo(() => {
    const cols = [];
    for (const period of periods) {
      for (const a of period.assessments) {
        for (const c of a.columns) {
          cols.push({ columnId: String(c.id), assessmentId: a.id, periodId: period.id });
        }
      }
    }
    const rows = students.map(s => String(s.id));
    return {
      cols,
      rows,
      colIndex: new Map(cols.map((c, i) => [c.columnId, i])),
      rowIndex: new Map(rows.map((r, i) => [r, i])),
    };
  }, [periods, students]);

  // Range operations commit the in-flight cell edit FIRST (through the
  // existing blur pipeline), so "what the operation saw" always equals what
  // the shared map says — and the two undo species stay cleanly separated.
  const withCommittedActiveCell = useCallback((fn) => {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    if (el && gridRef.current?.contains(el) && el.matches?.('input[data-cell="score"]')) {
      el.blur();
      requestAnimationFrame(() => fn());
    } else {
      fn();
    }
  }, []);

  // One entry point for every range mutation (clear, paste, fill): commit
  // the in-flight edit, then run the bulk pipeline.
  const handleApplyRange = useCallback((entries, label) => {
    withCommittedActiveCell(() => {
      applyBulkWrite({
        entries,
        label,
        getScores,
        onBulkUpdate,
        onHistoryPush,
        onSaveError,
        onAttendanceApplied,
      });
    });
  }, [withCommittedActiveCell, getScores, onBulkUpdate, onHistoryPush, onSaveError, onAttendanceApplied]);

  const wrapRef = useRef(null);

  // Focus Assessment mode (v1.7.0): entry points pass a columnId; this
  // resolver hands the page the full column/assessment/period context.
  const handleFocusColumn = useCallback((columnId) => {
    for (const period of periods) {
      for (const a of period.assessments) {
        const col = a.columns.find(c => String(c.id) === String(columnId));
        if (col) {
          onFocusColumn?.({ column: col, assessment: a, periodType: period.type });
          return;
        }
      }
    }
  }, [periods, onFocusColumn]);

  // --- Period-closing cluster (Phase 3a) -------------------------------------
  // "Missing" = blanks in ACTIVE columns (the class took it, this student has
  // nothing) — see src/lib/classStats.js for the rule and its tests.
  const missingByStudent = useMemo(
    () => missingCounts(geometry.cols, geometry.rows, scores),
    [geometry, scores]
  );

  // Stats footer: per-column class picture + per-period/final class averages.
  const footerStats = useMemo(() => {
    if (!showStats || students.length === 0) return null;
    const ids = geometry.rows;
    const perColumn = new Map(geometry.cols.map(c => [c.columnId, columnStats(c.columnId, ids, scores)]));
    const periodAvg = {};
    let finalSum = 0;
    let finalN = 0;
    for (const student of students) {
      const pg = {};
      for (const p of periods) pg[p.type] = computePeriodGrade(p.assessments, scores, student.id);
      for (const p of periods) {
        if (pg[p.type] !== null) {
          periodAvg[p.type] = periodAvg[p.type] || { s: 0, n: 0 };
          periodAvg[p.type].s += pg[p.type];
          periodAvg[p.type].n += 1;
        }
      }
      const f = computeFinalSubjectGrade(pg, subject);
      if (f !== null && f !== undefined) { finalSum += f; finalN += 1; }
    }
    const avgOf = (t) => (periodAvg[t] ? periodAvg[t].s / periodAvg[t].n : null);
    return { perColumn, avgOf, finalAvg: finalN ? finalSum / finalN : null };
  }, [showStats, geometry, scores, periods, students, subject]);

  // Fill-blanks-with-0: >5 cells confirms first (the paste-preview threshold);
  // smaller fills apply directly — undo covers regret either way.
  const [fillConfirm, setFillConfirm] = useState(null); // { entries, scope }
  const requestFillBlanks = useCallback((entries, scope) => {
    if (entries.length === 0) return;
    if (entries.length > 5) setFillConfirm({ entries, scope });
    else handleApplyRange(entries, `fill ${entries.length} blank${entries.length === 1 ? '' : 's'} with 0`);
  }, [handleApplyRange]);

  const handleGridKeyDown = useCallback((e) => {
    if (e.key !== 'F2' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const holder = e.target.closest?.('[data-col], [data-max-for]');
    const colId = holder?.getAttribute('data-col') || holder?.getAttribute('data-max-for');
    if (!colId) return;
    const assessment = colToAssessment.get(String(colId));
    if (!assessment || assessment.is_exam) return;
    e.preventDefault();
    gridRef.current?.querySelector(`[data-rename-assessment="${assessment.id}"]`)?.click();
  }, [colToAssessment]);

  const handleAddAssessment = async (periodId) => {
    const name = newAssessmentName.trim();
    if (!name) return;
    const body = { name, is_exam: 0, weight_percent: 0 };
    const res = await fetch(`/api/periods/${periodId}/assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const created = await res.json().catch(() => ({}));
    setNewAssessmentName('');
    setAddingAssessment(null);
    onRefreshPeriods();

    if (res.ok && created?.id && onHistoryPush) {
      let assessmentId = created.id;
      onHistoryPush({
        label: `add assessment "${name}"`,
        undo: async () => {
          await fetch(`/api/assessments/${assessmentId}`, { method: 'DELETE' });
          onRefreshPeriods();
        },
        redo: async () => {
          const r = await fetch(`/api/periods/${periodId}/assessments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const j = await r.json().catch(() => ({}));
          if (j?.id) assessmentId = j.id;
          onRefreshPeriods();
        },
      });
    }
  };

  const persistOrder = async (ids) => {
    await fetch(`/api/assessments/${ids[0]}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reorder: true, ids }),
    });
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const periodId = active.data.current?.periodId;
    // Assessments can only be reordered WITHIN their own grading period.
    if (!periodId || over.data.current?.periodId !== periodId) return;
    const period = periods.find(p => p.id === periodId);
    if (!period) return;
    const byId = new Map(period.assessments.map(a => [a.id, a]));
    // The exam itself is never draggable.
    if (byId.get(active.id)?.is_exam) return;
    const oldIds = period.assessments.map(a => a.id);
    const oldIdx = oldIds.indexOf(active.id);
    const newIdx = oldIds.indexOf(over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    // The exam is permanently last: anything dropped below it is placed
    // immediately above it (stable partition keeps relative order intact).
    const moved = arrayMove(oldIds, oldIdx, newIdx);
    const newIds = [
      ...moved.filter(x => !byId.get(x)?.is_exam),
      ...moved.filter(x => byId.get(x)?.is_exam),
    ];
    if (JSON.stringify(newIds) === JSON.stringify(oldIds)) return; // no-op after clamp
    onReorderLocal?.(periodId, newIds); // layout updates immediately on drop
    await persistOrder(newIds); // persist the new order in the database
    onRefreshPeriods();

    onHistoryPush?.({
      label: 'move assessment',
      undo: async () => {
        onReorderLocal?.(periodId, oldIds);
        await persistOrder(oldIds);
        onRefreshPeriods();
      },
      redo: async () => {
        onReorderLocal?.(periodId, newIds);
        await persistOrder(newIds);
        onRefreshPeriods();
      },
    });
  };

  // Total column count — must mirror the <colgroup> below exactly:
  // #, name, then per period (one col per assessment column, min 1) + grade,
  // then the final grade. Used by the no-students message row.
  const totalCols =
    2 +
    periods.reduce(
      (s, p) => s + p.assessments.reduce((x, a) => x + Math.max(a.columns.length, 1), 0) + 1,
      0
    ) +
    1;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    <div
      ref={gridRef}
      data-grid-scope
      className={`overflow-x-auto w-full gb-grid-scroll ${showMissingHighlight === false ? 'gb-hide-missing' : ''}`}
      // Dock-aware layout (v1.7.1): the sticky stats footer pins ABOVE the
      // floating scrollbar dock via this variable (see globals.css).
      style={{ '--gb-dock-h': proxyState.visible ? '42px' : '0px' }}
      onScroll={onGridScroll}
      onFocusCapture={handleGridFocus}
      onBlurCapture={handleGridBlur}
      onKeyDown={handleGridKeyDown}
    >
      {/* position:relative wrapper — the selection overlay's coordinate space
          (it scrolls WITH the table, so no scroll listeners are needed). */}
      <div ref={wrapRef} className="relative w-max">
      <table className="gradebook-table w-max text-xs">
        {/*
          Explicit column widths (table-layout: fixed). Every assessment
          date/score column gets ASSESSMENT_COL_WIDTH_PX from src/lib/uiConfig.js —
          change that constant to resize the whole grid.
        */}
        <colgroup>
          <col style={{ width: `${NUM_COL_WIDTH_PX}px` }} />
          <col style={{ width: `${nameColWidth}px` }} />
          {periods.map(period => (
            <React.Fragment key={period.id}>
              {period.assessments.map(a =>
                Array.from({ length: Math.max(a.columns.length, 1) }).map((_, i) => (
                  <col key={`${a.id}-${i}`} style={{ width: `${ASSESSMENT_COL_WIDTH_PX}px` }} />
                ))
              )}
              <col style={{ width: `${GRADE_COL_WIDTH_PX}px` }} />
            </React.Fragment>
          ))}
          <col style={{ width: `${FINAL_GRADE_COL_WIDTH_PX}px` }} />
        </colgroup>
        <thead>
          {/* Row 1: Period Headers */}
          <tr>
            <th className={`${STICKY_NO} border-b border-gray-200 bg-white w-10 text-center`} rowSpan={4}>#</th>
            <th className={`${STICKY_NAME} relative border-b border-gray-200 bg-white text-left px-3`} rowSpan={4}>
              Student Name
              {/* Excel-style resize: drag to size, double-click to auto-fit. */}
              <span
                onPointerDown={startNameResize}
                onDoubleClick={autoFitNameColumn}
                className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/50"
                title="Drag to resize · double-click to fit the longest name"
              />
            </th>

            {periods.map(period => {
              const colSpan = period.assessments.reduce((s, a) => s + Math.max(a.columns.length, 1), 0) + 1;
              const colors = PERIOD_COLORS[period.type];
              // Weights that don't total 100 are silently renormalized in the
              // grade math (correct for live standing) — this chip just stops
              // that from being INVISIBLE.
              const weightSum = period.assessments.reduce((s, a) => s + (parseFloat(a.weight_percent) || 0), 0);
              const weightsOff = weightSum > 0 && toCents(weightSum) !== 10000;
              return (
                <th
                  key={period.id}
                  colSpan={colSpan}
                  data-period-head={period.id}
                  onContextMenu={e => {
                    const periodCols = geometry.cols.filter(c => c.periodId === period.id);
                    const blanks = blankEntries(periodCols, geometry.rows, getScores?.() || scores, { onlyActive: true });
                    openMenu(e, [
                      { label: 'Add assessment…', onClick: () => setAddingAssessment(period.id) },
                      ...(blanks.length > 0 ? [{
                        label: `Fill blanks with 0 in ${period.type} (${blanks.length})`,
                        separatorBefore: true,
                        onClick: () => requestFillBlanks(blanks, period.type),
                      }] : []),
                    ]);
                  }}
                  title="Right-click for actions"
                  className={`${colors.header} text-white text-center py-1.5 px-3 font-semibold tracking-wide text-xs uppercase`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {period.type}
                    {weightsOff && (
                      <span
                        className="normal-case font-normal text-[10px] text-amber-200"
                        title={`Assessment weights total ${formatNumber(weightSum)}% — grades renormalize over the categories that have scores`}
                      >
                        · weights {formatNumber(weightSum)}%
                      </span>
                    )}
                  </div>
                  {addingAssessment === period.id && (
                    <div className="flex items-center gap-1 mt-1 justify-center">
                      <input
                        autoFocus
                        className="text-xs px-1.5 py-0.5 border border-white/30 rounded w-24 text-center bg-white/10 text-white placeholder-white/50 focus:outline-none focus:ring-1 focus:ring-white/50"
                        placeholder="Name"
                        value={newAssessmentName}
                        onChange={e => setNewAssessmentName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddAssessment(period.id)}
                      />
                      <button
                        onClick={() => handleAddAssessment(period.id)}
                        className="text-xs px-1.5 py-0.5 bg-white text-gray-800 rounded hover:bg-white/90"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => { setAddingAssessment(null); setNewAssessmentName(''); }}
                        className="text-xs text-white/70 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </th>
              );
            })}

            <th className="bg-blue-900 text-white text-center py-1.5 px-3 font-semibold text-xs" rowSpan={4}>
              Final<br />Grade
            </th>
          </tr>

          {/* Row 2: Assessment Names (the per-period "Grade" header spans rows 2-4) */}
          <tr>
            {periods.map(period => {
              const colors = PERIOD_COLORS[period.type];
              return (
                <React.Fragment key={period.id}>
                  <SortableContext
                    items={period.assessments.map(a => a.id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {period.assessments.map(a => (
                      <AssessmentBlock
                        key={a.id}
                        assessment={a}
                        periodId={period.id}
                        periodType={period.type}
                        subjectId={subject.id}
                        colors={colors}
                        mode="header-name"
                        onRefresh={onRefreshPeriods}
                        onRefreshData={onRefreshData}
                        onPatchAssessment={onPatchAssessment}
                        onPatchColumn={onPatchColumn}
                        getScores={getScores}
                        getPeriodOrder={getPeriodOrder}
                        onHistoryPush={onHistoryPush}
                        onSaveError={onSaveError}
                        onOpenMenu={openMenu}
                        onFocusColumn={handleFocusColumn}
                        onNotify={onNotify}
                      />
                    ))}
                  </SortableContext>
                  <th
                    rowSpan={3}
                    className={`${colors.light} ${colors.text} text-center font-semibold px-2 py-1.5`}
                  >
                    Grade
                  </th>
                </React.Fragment>
              );
            })}
          </tr>

          {/* Row 3: Dates */}
          <tr>
            {periods.map(period => {
              const colors = PERIOD_COLORS[period.type];
              return (
                <React.Fragment key={period.id}>
                  {period.assessments.map(a => (
                    <AssessmentBlock
                      key={a.id}
                      assessment={a}
                      periodId={period.id}
                        periodType={period.type}
                        subjectId={subject.id}
                      colors={colors}
                      mode="header-dates"
                      onRefresh={onRefreshPeriods}
                      onRefreshData={onRefreshData}
                      onPatchAssessment={onPatchAssessment}
                      onPatchColumn={onPatchColumn}
                      getScores={getScores}
                      getPeriodOrder={getPeriodOrder}
                      onHistoryPush={onHistoryPush}
                      onSaveError={onSaveError}
                      onOpenMenu={openMenu}
                      onFocusColumn={handleFocusColumn}
                      onNotify={onNotify}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </tr>

          {/* Row 4: Max Scores */}
          <tr>
            {periods.map(period => {
              const colors = PERIOD_COLORS[period.type];
              return (
                <React.Fragment key={period.id}>
                  {period.assessments.map(a => (
                    <AssessmentBlock
                      key={a.id}
                      assessment={a}
                      periodId={period.id}
                        periodType={period.type}
                        subjectId={subject.id}
                      colors={colors}
                      mode="header-max-scores"
                      onRefresh={onRefreshPeriods}
                      onRefreshData={onRefreshData}
                      onPatchAssessment={onPatchAssessment}
                      onPatchColumn={onPatchColumn}
                      getScores={getScores}
                      getPeriodOrder={getPeriodOrder}
                      onHistoryPush={onHistoryPush}
                      onSaveError={onSaveError}
                      onOpenMenu={openMenu}
                      onFocusColumn={handleFocusColumn}
                      onNotify={onNotify}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {/* The grid always renders (so assessments, columns, and dates can be
              set up before any students exist) — the empty state is a row. */}
          {students.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="bg-white text-center py-10 text-gray-400 text-sm">
                No students yet. Add students to begin entering grades.
              </td>
            </tr>
          )}
          {students.map((student, idx) => {
            const periodGrades = {};
            for (const period of periods) {
              const g = computePeriodGrade(period.assessments, scores, student.id);
              periodGrades[period.type] = g;
            }
            const finalGrade = computeFinalSubjectGrade(periodGrades, subject);

            return (
              <tr key={student.id} data-student-row={student.id}>
                {/* Canonical roster number — under a sorted/filtered VIEW the
                    number travels with the student; renumbering would lie. */}
                <td className={`${STICKY_NO} bg-white text-center text-gray-400 py-1`}>
                  {rosterNumbers?.get(String(student.id)) ?? idx + 1}
                </td>
                <td
                  className={`${STICKY_NAME} bg-white px-3 py-1 font-medium text-gray-800`}
                  onDoubleClick={() => onStudentFocus?.(student)}
                  onContextMenu={e => openMenu(e, [
                    { label: 'Student focus…', onClick: () => onStudentFocus?.(student) },
                    { label: 'Edit student…', separatorBefore: true, onClick: () => onEditStudent?.(student) },
                    { label: 'Add to Student Group…', onClick: () => onAddToGroup?.(student) },
                    { label: 'Delete student…', danger: true, separatorBefore: true, onClick: () => onDeleteStudent?.(student) },
                  ])}
                  title="Double-click for student focus · right-click for actions"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{displayName(student)}</span>
                    {(missingByStudent.get(String(student.id)) || 0) > 0 && (
                      <span
                        className="gb-missing-chip"
                        title={`${missingByStudent.get(String(student.id))} missing score${missingByStudent.get(String(student.id)) === 1 ? '' : 's'} — in columns the class has taken`}
                      >
                        {missingByStudent.get(String(student.id))}
                      </span>
                    )}
                  </span>
                </td>

                {periods.map(period => {
                  const colors = PERIOD_COLORS[period.type];
                  return (
                    <React.Fragment key={period.id}>
                      {period.assessments.map(a =>
                        a.columns.length > 0 ? (
                          a.columns.map(col => (
                            <td key={col.id} className="p-0 border-r border-gray-100">
                              <ScoreCell
                                columnId={col.id}
                                studentId={student.id}
                                initialValue={scores?.[col.id]?.[student.id]}
                                maxScore={col.max_score}
                                onUpdate={onUpdateScore}
                                onAttendanceApplied={onAttendanceApplied}
                                onHistoryPush={onHistoryPush}
                                onSaveError={onSaveError}
                              />
                            </td>
                          ))
                        ) : (
                          // Placeholder cell so body rows stay aligned with the
                          // header placeholder of assessments that have no columns yet.
                          <td key={`${a.id}-empty`} className="p-0 border-r border-gray-100 bg-gray-50/60" />
                        )
                      )}
                      <td key={`${period.id}-grade-${student.id}`} className={`grade-col ${colors.light} ${colors.text} text-center px-2 py-1 border-r-2 border-gray-300`}>
                        {formatGrade(periodGrades[period.type])}
                      </td>
                    </React.Fragment>
                  );
                })}

                <td className="final-grade-col text-center px-2 py-1">
                  {formatGrade(finalGrade)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* Class statistics footer (Phase 3a): sticky to the viewport bottom
            while the grid is on screen — where paper class records put their
            totals row. Two calm rows; High/Low/Median live in the tooltip. */}
        {footerStats && (
          <tfoot className="gb-stats-foot">
            <tr>
              <td className={`${STICKY_NO} gb-foot-label`} />
              <td className={`${STICKY_NAME} gb-foot-label px-3 text-right`}>Class average</td>
              {periods.map(period => (
                <React.Fragment key={period.id}>
                  {period.assessments.map(a =>
                    a.columns.length > 0 ? (
                      a.columns.map(col => {
                        const s = footerStats.perColumn.get(String(col.id));
                        return (
                          <td
                            key={col.id}
                            className="gb-foot-cell"
                            title={s && s.entered > 0
                              ? `High ${formatNumber(s.high)} · Low ${formatNumber(s.low)} · Median ${formatNumber(s.median)} · ${s.entered} of ${students.length} entered`
                              : 'No scores entered yet'}
                          >
                            {s && s.avg !== null ? formatNumber(s.avg) : '—'}
                          </td>
                        );
                      })
                    ) : (
                      <td key={`${a.id}-foot`} className="gb-foot-cell text-gray-300" />
                    )
                  )}
                  <td className={`gb-foot-cell font-semibold ${PERIOD_COLORS[period.type].text}`}>
                    {formatGrade(footerStats.avgOf(period.type))}
                  </td>
                </React.Fragment>
              ))}
              <td className="gb-foot-cell font-bold text-blue-800">{formatGrade(footerStats.finalAvg)}</td>
            </tr>
            <tr>
              <td className={`${STICKY_NO} gb-foot-label`} />
              <td className={`${STICKY_NAME} gb-foot-label px-3 text-right`}>Missing</td>
              {periods.map(period => (
                <React.Fragment key={period.id}>
                  {period.assessments.map(a =>
                    a.columns.length > 0 ? (
                      a.columns.map(col => {
                        const s = footerStats.perColumn.get(String(col.id));
                        const m = s ? s.missing : 0;
                        return (
                          <td key={col.id} className={`gb-foot-cell ${m > 0 && s.entered > 0 ? 'text-amber-600 font-semibold gb-missing-cue' : 'text-gray-300'}`}>
                            {s && s.entered > 0 ? (m > 0 ? m : '·') : ''}
                          </td>
                        );
                      })
                    ) : (
                      <td key={`${a.id}-footm`} className="gb-foot-cell" />
                    )
                  )}
                  <td className="gb-foot-cell" />
                </React.Fragment>
              ))}
              <td className="gb-foot-cell" />
            </tr>
          </tfoot>
        )}
      </table>
      <GridSelectionLayer
        gridRef={gridRef}
        wrapRef={wrapRef}
        geometry={geometry}
        getScores={getScores}
        onApplyRange={handleApplyRange}
        onOpenMenu={openMenu}
        onFocusColumn={handleFocusColumn}
      />
      </div>
    </div>
    {/* In-flow spacer (the StatusBar trick): when the dock floats, the page
        gains real bottom room — the last rows are never hidden under it. */}
    {proxyState.visible && <div className="h-11" aria-hidden="true" />}
    {fillConfirm && (
      <ConfirmDialog
        open
        danger={false}
        title="Fill blanks with 0?"
        message={`${fillConfirm.entries.length} blank cell${fillConfirm.entries.length === 1 ? '' : 's'} in ${fillConfirm.scope} will be set to 0. Columns with no scores at all are left untouched. Ctrl+Z undoes the whole fill.`}
        confirmLabel="Fill with 0"
        onConfirm={() => handleApplyRange(fillConfirm.entries, `fill ${fillConfirm.entries.length} blanks with 0`)}
        onClose={() => setFillConfirm(null)}
      />
    )}
    <ContextMenu menu={menu} onClose={closeMenu} />
    {/* Ctrl+F: find a student by any part of their name. */}
    <FindStudentBar students={students} gridRef={gridRef} />
    {/* Sticky navigation dock: PRELIM/MIDTERM/FINAL jump buttons + the
        horizontal scrollbar, together where sideways movement already
        happens. Width is configurable via STICKY_SCROLLBAR_WIDTH_PX in
        src/lib/uiConfig.js. */}
    {proxyState.visible && (
      <div
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-stretch bg-white/95 border border-gray-200 rounded shadow-md overflow-hidden"
        style={{ maxWidth: 'calc(100vw - 2rem)' }}
      >
        <div className="flex items-stretch border-r border-gray-200">
          {periods.map(p => (
            <button
              key={p.id}
              onClick={() => jumpToPeriod(p.id)}
              className={`px-2 text-[9px] font-bold tracking-wider leading-none hover:bg-gray-100 ${PERIOD_COLORS[p.type]?.text || 'text-gray-600'}`}
              title={`Jump to ${p.type}`}
            >
              {p.type}
            </button>
          ))}
        </div>
        <div
          ref={proxyRef}
          onScroll={onProxyScroll}
          className="overflow-x-scroll overflow-y-hidden"
          style={{ width: `min(${STICKY_SCROLLBAR_WIDTH_PX}px, calc(100vw - 16rem))`, height: '14px' }}
          title="Scroll the gradebook horizontally"
        >
          <div style={{ width: proxyState.w, height: 1 }} />
        </div>
      </div>
    )}
    </DndContext>
  );
}
