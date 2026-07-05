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
    updateScore, reorderAssessmentsLocal,
    refreshPeriods, refreshStudents, refreshScores, refreshSubject,
  };
}
