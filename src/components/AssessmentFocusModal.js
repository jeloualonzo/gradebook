'use client';
import { useMemo } from 'react';
import Modal from './Modal';
import ScoreCell from './ScoreCell';
import { columnStats } from '@/lib/classStats';
import { formatNumber } from '@/lib/gradeCalculator';
import { formatDateMMDDYYYY } from '@/lib/dateUtils';
import { displayName } from '@/lib/names';

/**
 * Focus Assessment mode (v1.7.0): one column, every student, zero
 * horizontal scrolling — the focused-grading answer to a 200-column term.
 *
 * The editing experience is identical to the main grid BY CONSTRUCTION:
 * these are the same ScoreCell components (autosave, session undo, Escape,
 * over-max flag, attendance mirroring — everything rides along), navigating
 * within their own [data-grid-scope] so Enter/arrows walk THIS list, not
 * the grid behind the modal. Edits land in the shared scores map, so the
 * grid is already up to date when the modal closes.
 */
export default function AssessmentFocusModal({
  focus,          // { column, assessment, periodType }
  students,       // the page's current view order
  scores,
  rosterNumbers,
  onUpdateScore,
  onAttendanceApplied,
  onHistoryPush,
  onSaveError,
  onClose,
}) {
  const { column, assessment, periodType } = focus;
  const stats = useMemo(
    () => columnStats(String(column.id), students.map(s => String(s.id)), scores),
    [column.id, students, scores]
  );

  return (
    <Modal open onClose={onClose} title={`${assessment.is_exam ? 'Exam' : assessment.name} — ${formatDateMMDDYYYY(column.date)}`} width="max-w-md">
      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span>{periodType} · max {formatNumber(column.max_score)}</span>
        <span>
          {stats.entered} of {students.length} entered
          {stats.avg !== null && <span className="ml-2">Avg {formatNumber(stats.avg)}</span>}
          {stats.missing > 0 && <span className="ml-2 text-amber-600">{stats.missing} missing</span>}
        </span>
      </div>
      <div data-grid-scope className="gradebook-table border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-xs gradebook-table">
          <tbody>
            {students.map((student, idx) => (
              <tr key={student.id} data-student-row={student.id}>
                <td className="w-8 text-center text-gray-400 py-1 bg-white">
                  {rosterNumbers?.get(String(student.id)) ?? idx + 1}
                </td>
                <td className="px-3 py-1 font-medium text-gray-800 bg-white">
                  <span className="truncate block max-w-[230px]">{displayName(student)}</span>
                </td>
                <td className="w-20 p-0">
                  <ScoreCell
                    columnId={column.id}
                    studentId={student.id}
                    initialValue={scores?.[column.id]?.[student.id]}
                    maxScore={column.max_score}
                    onUpdate={onUpdateScore}
                    onAttendanceApplied={onAttendanceApplied}
                    onHistoryPush={onHistoryPush}
                    onSaveError={onSaveError}
                  />
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-gray-400 text-sm">No students in the current view.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Enter moves down · Esc cancels an edit · everything autosaves, exactly like the grid.
      </p>
    </Modal>
  );
}
