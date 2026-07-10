'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGradebook } from '@/lib/hooks/useGradebook';
import { useHistory } from '@/lib/hooks/useHistory';
import { usePageTitle } from '@/lib/hooks/usePageTitle';
import { computeAllGrades } from '@/lib/gradeCalculator';
import { missingCounts, belowThreshold, rankOrder } from '@/lib/classStats';
import GradebookTable from '@/components/GradebookTable';
import StudentManager from '@/components/StudentManager';
import StudentForm from '@/components/StudentForm';
import AddToGroupDialog from '@/components/AddToGroupDialog';
import ImportStudentsDialog from '@/components/ImportStudentsDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';
import StudentFocusPanel from '@/components/StudentFocusPanel';

export default function GradebookPage() {
  const { id } = useParams();
  const router = useRouter();
  const {
    subject, periods, students, scores,
    loading, error,
    updateScore, bulkUpdateScores, reorderAssessmentsLocal, patchAssessmentLocal, patchColumnLocal,
    refreshPeriods, refreshStudents, refreshScores, refreshSubject,
  } = useGradebook(id);

  const [studentsOpen, setStudentsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Right-click actions on a student row in the grid.
  const [editStudentTarget, setEditStudentTarget] = useState(null);
  const [deleteStudentTarget, setDeleteStudentTarget] = useState(null);
  const [addToGroupTarget, setAddToGroupTarget] = useState(null);
  const [focusStudent, setFocusStudent] = useState(null); // conference-mode drawer
  const [savingStudent, setSavingStudent] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type, k: Date.now() }), []);

  // Context-rich window title (ROADMAP Phase 1) — the visible grading period
  // rides along as you scroll, so Alt+Tab always tells the truth:
  // "GE 3 Living in the IT Era — BSIS 3A — PRELIM — Faculty Gradebook".
  const [visiblePeriod, setVisiblePeriod] = useState(null);
  usePageTitle(
    subject
      ? `${subject.subject_code ? `${subject.subject_code} ` : ''}${subject.name} — ${subject.section}${visiblePeriod ? ` — ${visiblePeriod}` : ''}`
      : null
  );

  // Session restore: this is now the last-opened subject (device-local).
  useEffect(() => {
    if (!subject) return;
    try { window.localStorage.setItem('gb-last-subject', String(id)); } catch { /* non-fatal */ }
  }, [id, subject]);

  // --- Views: non-destructive lenses (Phase 3a) -------------------------------
  // Membership and order FREEZE when a view is applied (Excel doesn't
  // live-resort either): entering scores never makes rows jump mid-typing,
  // and filling a blank doesn't pop the student out from under the cursor.
  // Re-applying the control recomputes. The data never changes.
  const [viewMode, setViewMode] = useState('all');          // all | missing | below
  const [viewThreshold, setViewThreshold] = useState(75);   // view lens only — NOT grade policy
  const [viewSort, setViewSort] = useState('az');           // az | asc | desc
  const [viewIds, setViewIds] = useState(null);             // frozen id order, null = canonical
  const [showStats, setShowStats] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('gb-stats-footer') === '1';
  });

  const applyView = useCallback((mode, threshold, sort) => {
    setViewMode(mode); setViewThreshold(threshold); setViewSort(sort);
    if (mode === 'all' && sort === 'az') { setViewIds(null); return; }
    const grades = computeAllGrades({ subject, periods, scores }, students);
    const finalById = Object.fromEntries(students.map(s => [s.id, grades[s.id]?.FINAL_GRADE ?? null]));
    let list = students;
    if (mode === 'below') list = belowThreshold(students, finalById, threshold);
    if (mode === 'missing') {
      const cols = periods.flatMap(p => p.assessments.flatMap(a => a.columns.map(c => ({ columnId: String(c.id) }))));
      const mc = missingCounts(cols, students.map(s => String(s.id)), scores);
      list = students.filter(s => (mc.get(String(s.id)) || 0) > 0);
    }
    if (sort !== 'az') list = rankOrder(list, finalById, sort);
    setViewIds(list.map(s => s.id));
  }, [subject, periods, scores, students]);

  const viewStudents = useMemo(() => {
    if (!viewIds) return students;
    const byId = new Map(students.map(s => [s.id, s]));
    return viewIds.map(vid => byId.get(vid)).filter(Boolean);
  }, [students, viewIds]);

  // Canonical roster numbers travel with students under any view.
  const rosterNumbers = useMemo(
    () => new Map(students.map((s, i) => [String(s.id), i + 1])),
    [students]
  );

  const viewActive = viewIds !== null;
  const sortLabels = { az: 'A–Z', asc: 'Grade ↑', desc: 'Grade ↓' };
  const cycleSort = () => {
    const next = viewSort === 'az' ? 'asc' : viewSort === 'asc' ? 'desc' : 'az';
    applyView(viewMode, viewThreshold, next);
  };
  const toggleStats = () => {
    setShowStats(prev => {
      try { window.localStorage.setItem('gb-stats-footer', prev ? '0' : '1'); } catch { /* non-fatal */ }
      return !prev;
    });
  };

  // Conflicts in context: if sync auto-resolved edits in THIS subject and
  // they haven't been reviewed, a small banner points at them right where
  // the numbers live. Dismissible for the session; the Settings badge stays.
  const [conflictCount, setConflictCount] = useState(0);
  const [conflictsDismissed, setConflictsDismissed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/sync/conflicts?subjectId=${id}&unreviewedOnly=1&limit=200`);
        const d = await res.json();
        if (alive && res.ok) setConflictCount((d.conflicts || []).length);
      } catch { /* non-fatal */ }
    })();
    return () => { alive = false; };
  }, [id]);

  // Excel-style undo/redo (Ctrl+Z / Ctrl+Y) for gradebook edits.
  const history = useHistory({ onNotify: showToast });
  const refreshData = useCallback(() => { refreshPeriods(); refreshScores(); }, [refreshPeriods, refreshScores]);

  // "Counts as attendance" mirror: the score save response says what the
  // server wrote into Attendance — patch the grid instantly (and pull the
  // period structure only when a brand-new attendance date column appeared).
  const handleAttendanceApplied = useCallback((att) => {
    updateScore(att.column_id, att.student_id, att.value);
    if (att.column_created) refreshPeriods();
  }, [updateScore, refreshPeriods]);
  const handleSaveError = useCallback((msg) => showToast(msg || 'Save failed — value restored.', 'error'), [showToast]);

  // Ref mirrors so memoized children receive STABLE getter props while still
  // reading fresh data at event time (avoids re-rendering the whole grid).
  const scoresRef = useRef(scores);
  const periodsRef = useRef(periods);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { periodsRef.current = periods; }, [periods]);
  const getScores = useCallback(() => scoresRef.current, []);

  const handleStudentEditSave = async (form) => {
    setSavingStudent(true);
    try {
      const res = await fetch(`/api/students/${editStudentTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Could not save the student.');
      setEditStudentTarget(null);
      showToast('Student updated');
      refreshStudents();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingStudent(false);
    }
  };

  const handleStudentDelete = async () => {
    const target = deleteStudentTarget;
    setDeleteStudentTarget(null);
    if (!target) return;
    const res = await fetch(`/api/students/${target.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(`${target.last_name}, ${target.first_name} removed`);
      refreshStudents();
      refreshScores();
    } else {
      showToast('Could not delete the student.', 'error');
    }
  };
  const getPeriodOrder = useCallback((periodId) => {
    const p = periodsRef.current.find(x => x.id === periodId);
    return (p?.assessments || []).map(a => a.id);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading gradebook…</div>
      </div>
    );
  }

  if (error || !subject) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600 mb-4">{error || 'Subject not found'}</p>
          <Link href="/" className="text-sm text-blue-600 hover:underline">← Back to subjects</Link>
        </div>
      </div>
    );
  }

  const prelimPeriod = periods.find(p => p.type === 'PRELIM');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-700 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-gray-900 truncate">
            {subject.subject_code && <span className="text-blue-700 font-bold mr-1.5">{subject.subject_code}</span>}
            {subject.name}
          </h1>
          <p className="text-xs text-gray-500">
            {subject.section} · {subject.school_year} · {subject.semester === '1st' ? '1st Semester' : subject.semester === '2nd' ? '2nd Semester' : 'Summer'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Views (Phase 3a): non-destructive lenses — filter/rank freeze on
              apply; the amber chip + "All students" restore the full roster. */}
          <div className="flex items-center gap-1">
            <select
              value={viewMode}
              onChange={e => applyView(e.target.value, viewThreshold, viewSort)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="View — a lens on the roster; the data never changes"
            >
              <option value="all">All students</option>
              <option value="missing">With missing work</option>
              <option value="below">Below threshold</option>
            </select>
            {viewMode === 'below' && (
              <input
                type="number"
                value={viewThreshold}
                min="0"
                max="100"
                onChange={e => applyView('below', parseFloat(e.target.value) || 0, viewSort)}
                className="w-14 text-xs border border-gray-200 rounded-lg px-1.5 py-1.5 text-center bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Failing threshold — a view setting only, never a grade policy"
              />
            )}
            <button
              onClick={cycleSort}
              className={`px-2 py-1.5 text-xs border rounded-lg ${viewSort !== 'az' ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Sort the view (order freezes until changed — rows never jump mid-entry)"
            >
              {sortLabels[viewSort]}
            </button>
            <button
              onClick={toggleStats}
              className={`px-2 py-1.5 text-xs border rounded-lg ${showStats ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              title="Class statistics footer — averages and missing counts per column"
            >
              Stats
            </button>
          </div>
          {viewActive ? (
            <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              {viewStudents.length} of {students.length}
              <button
                onClick={() => applyView('all', viewThreshold, 'az')}
                className="ml-0.5 text-amber-500 hover:text-amber-800"
                title="Show all students, alphabetical"
              >
                ✕
              </button>
            </span>
          ) : (
            <span className="text-xs text-gray-400">{students.length} student{students.length !== 1 ? 's' : ''}</span>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={history.undo}
              disabled={!history.canUndo}
              title="Undo (Ctrl+Z)"
              className="p-1.5 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
              </svg>
            </button>
            <button
              onClick={history.redo}
              disabled={!history.canRedo}
              title="Redo (Ctrl+Y)"
              className="p-1.5 text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
              </svg>
            </button>
          </div>

          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
            title="Copy students from a Student Group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import Students
          </button>

          <button
            onClick={() => setStudentsOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            Students
          </button>

          {prelimPeriod && (
            <Link
              href={`/subjects/${id}/attendance?periodId=${prelimPeriod.id}`}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Attendance
            </Link>
          )}

          <a
            href={`/api/export/excel/${id}`}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Excel
          </a>

          <a
            href={`/api/export/pdf/${id}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            PDF
          </a>
        </div>
      </header>

      {conflictCount > 0 && !conflictsDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center gap-3 shrink-0 text-xs text-amber-900">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="flex-1 min-w-0">
            {conflictCount} conflicting edit{conflictCount !== 1 ? 's' : ''} in this subject
            {conflictCount !== 1 ? ' were' : ' was'} resolved automatically by sync (newest kept).
            Both versions are saved — you can review and restore.
          </span>
          <Link href="/settings?tab=conflicts" className="font-semibold underline hover:text-amber-950 whitespace-nowrap">
            Review
          </Link>
          <button
            onClick={() => setConflictsDismissed(true)}
            className="p-0.5 text-amber-400 hover:text-amber-700"
            title="Hide for now"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <GradebookTable
          subject={subject}
          periods={periods}
          students={viewStudents}
          scores={scores}
          showStats={showStats}
          rosterNumbers={rosterNumbers}
          onVisiblePeriodChange={setVisiblePeriod}
          onUpdateScore={updateScore}
          onBulkUpdate={bulkUpdateScores}
          onAttendanceApplied={handleAttendanceApplied}
          onRefreshPeriods={refreshPeriods}
          onRefreshData={refreshData}
          onReorderLocal={reorderAssessmentsLocal}
          onPatchAssessment={patchAssessmentLocal}
          onPatchColumn={patchColumnLocal}
          getScores={getScores}
          getPeriodOrder={getPeriodOrder}
          onHistoryPush={history.push}
          onSaveError={handleSaveError}
          onStudentFocus={setFocusStudent}
          onEditStudent={setEditStudentTarget}
          onDeleteStudent={setDeleteStudentTarget}
          onAddToGroup={setAddToGroupTarget}
        />
      </div>

      <AddToGroupDialog
        open={!!addToGroupTarget}
        student={addToGroupTarget}
        onClose={() => setAddToGroupTarget(null)}
        onDone={(msg) => showToast(msg)}
      />

      <Modal open={studentsOpen} onClose={() => setStudentsOpen(false)} title="Manage Students" width="max-w-md">
        <StudentManager
          subjectId={id}
          students={students}
          onRefresh={() => { refreshStudents(); refreshScores(); }}
        />
      </Modal>

      <Modal open={!!editStudentTarget} onClose={() => setEditStudentTarget(null)} title="Edit Student" width="max-w-sm">
        {editStudentTarget && (
          <StudentForm
            initial={editStudentTarget}
            onSubmit={handleStudentEditSave}
            onCancel={() => setEditStudentTarget(null)}
            loading={savingStudent}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteStudentTarget}
        onClose={() => setDeleteStudentTarget(null)}
        onConfirm={handleStudentDelete}
        title="Remove Student"
        message={deleteStudentTarget ? `Remove ${deleteStudentTarget.last_name}, ${deleteStudentTarget.first_name}? Their scores will be deleted.` : ''}
      />

      <ImportStudentsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        subjectId={id}
        onImported={({ imported, skipped }) => {
          showToast(
            `Imported ${imported} student${imported !== 1 ? 's' : ''}` +
            (skipped ? ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)` : '')
          );
          refreshStudents();
          refreshScores();
        }}
      />

      {focusStudent && (
        <StudentFocusPanel
          student={focusStudent}
          subject={subject}
          periods={periods}
          scores={scores}
          rosterNo={rosterNumbers.get(String(focusStudent.id))}
          onClose={() => setFocusStudent(null)}
        />
      )}

      {toast && (
        <Toast key={toast.k} message={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
