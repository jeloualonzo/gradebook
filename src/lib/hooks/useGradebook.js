'use client';
import { useState, useEffect, useCallback } from 'react';

export function useGradebook(subjectId) {
  const [subject, setSubject] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    // NOTE: loading starts as true in state, so no synchronous setState is
    // needed here (fetchAll only runs on mount / subjectId change).
    setError(null);
    try {
      const [subjectRes, periodsRes, studentsRes, scoresRes] = await Promise.all([
        fetch(`/api/subjects/${subjectId}`),
        fetch(`/api/subjects/${subjectId}/periods`),
        fetch(`/api/subjects/${subjectId}/students`),
        fetch(`/api/subjects/${subjectId}/scores`),
      ]);

      if (!subjectRes.ok) throw new Error('Subject not found');
      if (!periodsRes.ok) throw new Error('Failed to load grading periods');
      if (!studentsRes.ok) throw new Error('Failed to load student list');
      if (!scoresRes.ok) throw new Error('Failed to load grades');

      const subjectData = await subjectRes.json();
      const periodsData = await periodsRes.json();
      const studentsData = await studentsRes.json();
      const scoresData = await scoresRes.json();

      setSubject(subjectData);
      setPeriods(Array.isArray(periodsData) ? periodsData : []);
      setStudents(Array.isArray(studentsData) ? studentsData : []);
      setScores(scoresData && typeof scoresData === 'object' ? scoresData : {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  const updateScore = useCallback((columnId, studentId, value) => {
    setScores(prev => ({
      ...prev,
      [columnId]: {
        ...(prev[columnId] || {}),
        [studentId]: value,
      },
    }));
  }, []);

  // Optimistically patch one assessment's fields in local state.
  // Only the target assessment object changes identity, so memoized header
  // cells for every other assessment skip re-rendering.
  const patchAssessmentLocal = useCallback((assessmentId, patch) => {
    setPeriods(prev => prev.map(p => {
      if (!p.assessments?.some(a => a.id === assessmentId)) return p;
      return {
        ...p,
        assessments: p.assessments.map(a => (a.id === assessmentId ? { ...a, ...patch } : a)),
      };
    }));
  }, []);

  // Columns order: dated chronologically, undated (new) always last —
  // mirrors the server ordering so optimistic date edits re-sort instantly.
  const columnOrder = (a, b) => {
    const an = a.date == null;
    const bn = b.date == null;
    if (an !== bn) return an ? 1 : -1;
    if (!an && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.sort_order || 0) - (b.sort_order || 0);
  };

  // Optimistically patch one assessment column (date / max score).
  const patchColumnLocal = useCallback((columnId, patch) => {
    setPeriods(prev => prev.map(p => {
      if (!p.assessments?.some(a => a.columns?.some(c => c.id === columnId))) return p;
      return {
        ...p,
        assessments: p.assessments.map(a =>
          a.columns?.some(c => c.id === columnId)
            ? {
                ...a,
                columns: a.columns
                  .map(c => (c.id === columnId ? { ...c, ...patch } : c))
                  .sort(columnOrder),
              }
            : a
        ),
      };
    }));
  }, []);

  // Reorder a period's assessments in local state immediately (optimistic),
  // so the layout updates the moment a drag is dropped.
  const reorderAssessmentsLocal = useCallback((periodId, orderedIds) => {
    setPeriods(prev => prev.map(p => {
      if (p.id !== periodId) return p;
      const byId = new Map(p.assessments.map(a => [a.id, a]));
      const reordered = orderedIds.map(oid => byId.get(oid)).filter(Boolean);
      return reordered.length === p.assessments.length ? { ...p, assessments: reordered } : p;
    }));
  }, []);

  const refreshPeriods = useCallback(async () => {
    try {
      const res = await fetch(`/api/subjects/${subjectId}/periods`);
      if (res.ok) {
        const data = await res.json();
        setPeriods(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    }
  }, [subjectId]);

  const refreshStudents = useCallback(async () => {
    try {
      const res = await fetch(`/api/subjects/${subjectId}/students`);
      if (res.ok) {
        const data = await res.json();
        setStudents(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    }
  }, [subjectId]);

  const refreshScores = useCallback(async () => {
    try {
      const res = await fetch(`/api/subjects/${subjectId}/scores`);
      if (res.ok) {
        const data = await res.json();
        setScores(data && typeof data === 'object' ? data : {});
      }
    } catch (err) {
      console.error(err);
    }
  }, [subjectId]);

  const refreshSubject = useCallback(async () => {
    try {
      const res = await fetch(`/api/subjects/${subjectId}`);
      if (res.ok) {
        const data = await res.json();
        setSubject(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [subjectId]);

  return {
    subject, periods, students, scores,
    loading, error,
    updateScore, reorderAssessmentsLocal, patchAssessmentLocal, patchColumnLocal,
    refreshPeriods, refreshStudents, refreshScores, refreshSubject,
  };
}
