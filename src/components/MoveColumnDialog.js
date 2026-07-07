'use client';
import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { displayName } from '@/lib/names';
import { formatDateMMDDYYYY } from '@/lib/dateUtils';

const CREATE = '__create__';

/**
 * Move one date column (and its scores) to another subject / period /
 * category. Shows a live match preview — scores travel by student identity —
 * before anything is written.
 */
export default function MoveColumnDialog({ open, onClose, column, assessmentName, sourceSubjectId, sourcePeriodType, onMoved }) {
  const [subjects, setSubjects] = useState([]);
  const [destSubject, setDestSubject] = useState('');
  const [destPeriod, setDestPeriod] = useState(sourcePeriodType || 'PRELIM');
  const [destPeriods, setDestPeriods] = useState([]); // periods (+assessments) of the chosen subject
  const [destCategory, setDestCategory] = useState(CREATE);
  const [preview, setPreview] = useState(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');

  // Reset per open (render-time adjustment).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDestSubject('');
      setDestPeriod(sourcePeriodType || 'PRELIM');
      setDestCategory(CREATE);
      setPreview(null);
      setCreateMissing(false);
      setError('');
    }
  }

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/subjects');
        const d = await res.json();
        if (res.ok) setSubjects(Array.isArray(d) ? d : []);
      } catch { /* non-fatal */ }
    })();
  }, [open]);

  useEffect(() => {
    // (Stale periods while no subject is chosen are harmless — the period
    // and category selects only render once a destination is picked.)
    if (!open || !destSubject) return;
    (async () => {
      try {
        const res = await fetch(`/api/subjects/${destSubject}/periods`);
        const d = await res.json();
        if (res.ok) setDestPeriods(Array.isArray(d) ? d : []);
      } catch { /* non-fatal */ }
    })();
  }, [open, destSubject]);

  // Category options for the chosen period (exam excluded by design).
  const periodAssessments = (destPeriods.find(p => p.type === destPeriod)?.assessments || []).filter(a => !a.is_exam);
  const sameNameExists = periodAssessments.some(a => a.name.toLowerCase() === String(assessmentName || '').toLowerCase());

  // Default the category to the same-named one when it exists.
  const [prevKey, setPrevKey] = useState('');
  const key = `${destSubject}|${destPeriod}|${periodAssessments.map(a => a.id).join(',')}`;
  if (key !== prevKey) {
    setPrevKey(key);
    setDestCategory(sameNameExists
      ? periodAssessments.find(a => a.name.toLowerCase() === String(assessmentName || '').toLowerCase()).name
      : CREATE);
    setPreview(null);
  }

  const loadPreview = useCallback(async () => {
    if (!destSubject || !destPeriod || !column) return;
    setError('');
    try {
      const res = await fetch(`/api/columns/${column.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: destSubject,
          period_type: destPeriod,
          assessment_name: destCategory === CREATE ? assessmentName : destCategory,
          dry_run: true,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Preview failed');
      setPreview(d);
    } catch (err) {
      setPreview(null);
      setError(err.message);
    }
  }, [destSubject, destPeriod, destCategory, column, assessmentName]);

  useEffect(() => {
    if (!open) return;
    (async () => { await loadPreview(); })();
  }, [open, loadPreview]);

  const move = async () => {
    setMoving(true);
    setError('');
    try {
      const res = await fetch(`/api/columns/${column.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: destSubject,
          period_type: destPeriod,
          assessment_name: destCategory === CREATE ? assessmentName : destCategory,
          create_missing_students: createMissing,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Move failed');
      onMoved?.(d);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setMoving(false);
    }
  };

  const selectClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <Modal open={open} onClose={onClose} title="Move to Another Subject" width="max-w-md">
      <div className="space-y-4">
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
          Moving <span className="font-medium text-gray-700">{assessmentName}</span>
          {column?.date ? <> — <span className="font-medium text-gray-700">{formatDateMMDDYYYY(column.date)}</span></> : null}
          {' '}with its max score and all student scores. Scores follow each student by
          <span className="font-medium text-gray-700"> name</span>, never by row position.
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Destination subject</label>
          <select className={selectClass} value={destSubject} onChange={e => setDestSubject(e.target.value)}>
            <option value="">Choose a subject…</option>
            {subjects.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.section}{s.id === sourceSubjectId ? ' (this subject)' : ''}
              </option>
            ))}
          </select>
        </div>

        {destSubject && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Grading period</label>
              <select className={selectClass} value={destPeriod} onChange={e => setDestPeriod(e.target.value)}>
                {['PRELIM', 'MIDTERM', 'FINAL'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <select className={selectClass} value={destCategory} onChange={e => setDestCategory(e.target.value)}>
                {periodAssessments.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                <option value={CREATE}>➕ Create “{assessmentName}”</option>
              </select>
            </div>
          </div>
        )}

        {preview && (
          <div className="text-xs rounded-lg border border-gray-100 p-3 space-y-1.5 bg-white">
            <div className="text-green-700 font-medium">
              {preview.matched} score{preview.matched !== 1 ? 's' : ''} will move with matching students
            </div>
            {preview.will_create_assessment && (
              <div className="text-gray-500">The “{preview.assessment_name}” category will be created in the destination.</div>
            )}
            {preview.unmatched.length > 0 && (
              <div className="text-amber-700">
                {preview.unmatched.length} student{preview.unmatched.length !== 1 ? 's are' : ' is'} not in the destination subject:
                <span className="block text-amber-800 mt-0.5">
                  {preview.unmatched.map(displayName).join(' · ')}
                </span>
                <label className="flex items-center gap-1.5 mt-2 text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={createMissing} onChange={e => setCreateMissing(e.target.checked)} />
                  Add them to the destination subject (scores carried along)
                </label>
                {!createMissing && (
                  <div className="text-gray-400 mt-1">Unchecked: their scores will NOT be carried.</div>
                )}
              </div>
            )}
          </div>
        )}

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={move}
            disabled={!destSubject || !preview || moving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {moving ? 'Moving…' : 'Move Column'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
