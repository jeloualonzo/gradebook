'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGradebook } from '@/lib/hooks/useGradebook';
import { useHistory } from '@/lib/hooks/useHistory';
import { usePageTitle } from '@/lib/hooks/usePageTitle';
import GradebookTable from '@/components/GradebookTable';
import StudentManager from '@/components/StudentManager';
import StudentForm from '@/components/StudentForm';
import AddToGroupDialog from '@/components/AddToGroupDialog';
import ImportStudentsDialog from '@/components/ImportStudentsDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';

export default function GradebookPage() {
  const { id } = useParams();
  const router = useRouter();
  const {
    subject, periods, students, scores,
    loading, error,
    updateScore, reorderAssessmentsLocal, patchAssessmentLocal, patchColumnLocal,
    refreshPeriods, refreshStudents, refreshScores, refreshSubject,
  } = useGradebook(id);

  const [studentsOpen, setStudentsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Right-click actions on a student row in the grid.
  const [editStudentTarget, setEditStudentTarget] = useState(null);
  const [deleteStudentTarget, setDeleteStudentTarget] = useState(null);
  const [addToGroupTarget, setAddToGroupTarget] = useState(null);
  const [savingStudent, setSavingStudent] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type, k: Date.now() }), []);

  // Window title: "Programming Fundamentals • ACT A • Faculty Gradebook".
  usePageTitle(subject ? `${subject.name} • ${subject.section}` : null);

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
          <span className="text-xs text-gray-400">{students.length} student{students.length !== 1 ? 's' : ''}</span>

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

      <div className="flex-1 overflow-auto p-4">
        <GradebookTable
          subject={subject}
          periods={periods}
          students={students}
          scores={scores}
          onUpdateScore={updateScore}
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

      {toast && (
        <Toast key={toast.k} message={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
