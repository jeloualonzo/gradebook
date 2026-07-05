'use client';
import { useState } from 'react';
import React from 'react';
import ScoreCell from './ScoreCell';
import { formatGrade, computePeriodGrade, computeFinalSubjectGrade } from '@/lib/gradeCalculator';
import AssessmentBlock from './AssessmentBlock';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  ASSESSMENT_COL_WIDTH_PX,
  GRADE_COL_WIDTH_PX,
  FINAL_GRADE_COL_WIDTH_PX,
  NUM_COL_WIDTH_PX,
  NAME_COL_WIDTH_PX,
} from '@/lib/uiConfig';

const PERIOD_COLORS = {
  PRELIM: { header: 'bg-blue-700', light: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  MIDTERM: { header: 'bg-green-700', light: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
  FINAL: { header: 'bg-orange-700', light: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
};

const STICKY_NO = 'sticky-col';
const STICKY_NAME = 'sticky-col-2';

export default function GradebookTable({ subject, periods, students, scores, onUpdateScore, onRefreshPeriods, onReorderLocal }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [addingAssessment, setAddingAssessment] = useState(null);
  const [newAssessmentName, setNewAssessmentName] = useState('');

  const handleAddAssessment = async (periodId) => {
    if (!newAssessmentName.trim()) return;
    await fetch(`/api/periods/${periodId}/assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newAssessmentName.trim(), is_exam: 0, weight_percent: 0 }),
    });
    setNewAssessmentName('');
    setAddingAssessment(null);
    onRefreshPeriods();
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
    const oldIds = period.assessments.map(a => a.id);
    const oldIdx = oldIds.indexOf(active.id);
    const newIdx = oldIds.indexOf(over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newIds = arrayMove(oldIds, oldIdx, newIdx);
    onReorderLocal?.(periodId, newIds); // layout updates immediately on drop
    await persistOrder(newIds); // persist the new order in the database
    onRefreshPeriods();
  };

  if (!students.length) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        No students yet. Add students to begin entering grades.
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    <div className="overflow-x-auto w-full">
      <table className="gradebook-table w-max text-xs">
        {/*
          Explicit column widths (table-layout: fixed). Every assessment
          date/score column gets ASSESSMENT_COL_WIDTH_PX from src/lib/uiConfig.js —
          change that constant to resize the whole grid.
        */}
        <colgroup>
          <col style={{ width: `${NUM_COL_WIDTH_PX}px` }} />
          <col style={{ width: `${NAME_COL_WIDTH_PX}px` }} />
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
            <th className={`${STICKY_NAME} border-b border-gray-200 bg-white w-48 text-left px-3`} rowSpan={4}>Student Name</th>

            {periods.map(period => {
              const colSpan = period.assessments.reduce((s, a) => s + Math.max(a.columns.length, 1), 0) + 1;
              const colors = PERIOD_COLORS[period.type];
              return (
                <th
                  key={period.id}
                  colSpan={colSpan}
                  className={`${colors.header} text-white text-center py-1.5 px-3 font-semibold tracking-wide text-xs uppercase`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {period.type}
                    <button
                      onClick={() => setAddingAssessment(period.id)}
                      className="text-white/70 hover:text-white transition-colors"
                      title="Add assessment"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
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
                        colors={colors}
                        mode="header-name"
                        onRefresh={onRefreshPeriods}
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
                      colors={colors}
                      mode="header-dates"
                      onRefresh={onRefreshPeriods}
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
                      colors={colors}
                      mode="header-max-scores"
                      onRefresh={onRefreshPeriods}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {students.map((student, idx) => {
            const periodGrades = {};
            for (const period of periods) {
              const g = computePeriodGrade(period.assessments, scores, student.id);
              periodGrades[period.type] = g;
            }
            const finalGrade = computeFinalSubjectGrade(periodGrades, subject);

            return (
              <tr key={student.id} className="hover:bg-gray-50/50">
                <td className={`${STICKY_NO} bg-white text-center text-gray-400 py-1`}>{idx + 1}</td>
                <td className={`${STICKY_NAME} bg-white px-3 py-1 font-medium text-gray-800 truncate max-w-[180px]`}>
                  {student.last_name}, {student.first_name}
                  {student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}
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
      </table>
    </div>
    </DndContext>
  );
}
