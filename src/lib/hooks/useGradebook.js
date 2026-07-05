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
    setLoading(true);
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateScore = useCallback((columnId, studentId, value) => {
    setScores(prev => ({
      ...prev,
      [columnId]: {
        ...(prev[columnId] || {}),
        [studentId]: value,
      },
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
    updateScore, refreshPeriods, refreshStudents, refreshScores, refreshSubject,
  };
}
