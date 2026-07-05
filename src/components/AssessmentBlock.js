'use client';
import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { formatNumber } from '@/lib/gradeCalculator';
import { toDateInputValue, formatDateMMDDYYYY } from '@/lib/dateUtils';

export default function AssessmentBlock({ assessment, periodId, colors, mode, onRefresh }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(assessment.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingDate, setAddingDate] = useState(false);
  const [editingWeight, setEditingWeight] = useState(false);
  const [weight, setWeight] = useState(assessment.weight_percent);
  const [confirmDeleteColumn, setConfirmDeleteColumn] = useState(null);
  const [editingDate, setEditingDate] = useState(null);

  const colSpan = Math.max(assessment.columns.length, 1);

  const saveName = async () => {
    setEditingName(false);
    if (name === assessment.name) return;
    await fetch(`/api/assessments/${assessment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    onRefresh();
  };

  const saveWeight = async () => {
    setEditingWeight(false);
    const weightNum = parseFloat(weight);
    const currentWeight = parseFloat(assessment.weight_percent);
    if (Math.abs(weightNum - currentWeight) < 0.001) return;
    await fetch(`/api/assessments/${assessment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight_percent: Math.round(weightNum * 100) / 100 }),
    });
    onRefresh();
  };

  const deleteAssessment = async () => {
    await fetch(`/api/assessments/${assessment.id}`, { method: 'DELETE' });
    onRefresh();
  };

  const addColumn = async () => {
    await fetch(`/api/assessments/${assessment.id}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: null, max_score: 0 }),
    });
    onRefresh();
  };

  const updateMaxScore = async (colId, value) => {
    await fetch(`/api/columns/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_score: value }),
    });
    onRefresh();
  };

  const updateColumnDate = async (colId, value) => {
    await fetch(`/api/columns/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: value || null }),
    });
    onRefresh();
  };

  // Commit a date edit. Saves ONLY when the value actually changed, so
  // clicking a date and clicking away never mutates it.
  const commitDate = (col, inputValue) => {
    setEditingDate(null);
    const prev = toDateInputValue(col.date);
    const next = inputValue || '';
    if (next === prev) return;
    updateColumnDate(col.id, next || null);
  };

  // Commit a max-score edit only when the value actually changed.
  const commitMaxScore = (col, inputValue) => {
    const prev = parseFloat(col.max_score) || 0;
    const next = parseFloat(inputValue) || 0;
    if (Math.abs(next - prev) < 0.001) return;
    updateMaxScore(col.id, inputValue);
  };

  const deleteColumn = async (colId) => {
    await fetch(`/api/columns/${colId}`, { method: 'DELETE' });
    onRefresh();
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
      <th
        colSpan={colSpan}
        className={`${colors.light} border-r border-b border-gray-200 text-center px-2 py-1.5`}
      >
        <div className="flex items-center justify-center gap-1">
          {editingName ? (
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
          message={`Delete "${assessment.name}"? All scores in this category will be removed.`}
        />
      </th>
    );
  }

  if (mode === 'header-dates') {
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
            <button
              onClick={() => handleDeleteColumn(col.id)}
              className="absolute right-0 top-1/2 -translate-y-1/2 hidden group-hover:block bg-white/95 rounded-sm p-0.5 text-gray-300 hover:text-red-500 transition-colors"
              title="Remove column"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
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
