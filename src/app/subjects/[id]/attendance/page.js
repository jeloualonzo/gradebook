'use client';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Toast from '@/components/Toast';
import { todayLocalISO, toDateInputValue, formatDateMMDDYYYY } from '@/lib/dateUtils';
import { displayName } from '@/lib/names';
import { isTypingTarget } from '@/lib/hooks/useHotkey';
import { usePageTitle } from '@/lib/hooks/usePageTitle';

const STATUS_OPTIONS = [
  { key: 'P', label: 'Present', color: 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200', activeColor: 'bg-green-600 text-white border-green-600' },
  { key: 'L', label: 'Late', color: 'bg-yellow-100 text-yellow-700 border-yellow-300 hover:bg-yellow-200', activeColor: 'bg-yellow-500 text-white border-yellow-500' },
  { key: 'A', label: 'Absent', color: 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200', activeColor: 'bg-red-600 text-white border-red-600' },
];

export default function AttendancePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><span className="text-sm text-gray-400">Loading…</span></div>}>
      <AttendanceContent />
    </Suspense>
  );
}

function AttendanceContent() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const periodId = searchParams.get('periodId');

  const [periods, setPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(periodId || '');
  const [students, setStudents] = useState([]);
  const [date, setDate] = useState(todayLocalISO());
  const [statuses, setStatuses] = useState({});
  const [config, setConfig] = useState({ present_score: 10, late_score: 8, absent_score: 0 });
  const [scores, setScores] = useState(null); // null until loaded
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  // Keyboard workflow: the highlighted student the P/L/A keys apply to.
  const [selIdx, setSelIdx] = useState(0);

  usePageTitle('Attendance');

  useEffect(() => {
    async function load() {
      const [periodsRes, studentsRes, scoresRes] = await Promise.all([
        fetch(`/api/subjects/${id}/periods`),
        fetch(`/api/subjects/${id}/students`),
        fetch(`/api/subjects/${id}/scores`),
      ]);
      const periodsData = await periodsRes.json();
      const studentsData = await studentsRes.json();
      const scoresData = await scoresRes.json();
      setPeriods(periodsData);
      setStudents(studentsData);
      setScores(scoresData && typeof scoresData === 'object' ? scoresData : {});
      // Default to the first period without re-running this effect on change.
      setSelectedPeriodId(prev => prev || (periodsData.length > 0 ? String(periodsData[0].id) : ''));
    }
    load();
  }, [id]);

  const selectedPeriod = useMemo(
    () => periods.find(p => String(p.id) === String(selectedPeriodId)) || null,
    [periods, selectedPeriodId]
  );

  // Derived — no state/effect needed.
  const attendanceAssessment = useMemo(
    () => selectedPeriod?.assessments?.find(a => a.name.toLowerCase() === 'attendance') || null,
    [selectedPeriod]
  );
  const attendanceAssessmentId = attendanceAssessment?.id || null;

  // The existing Attendance column matching the picked date, if there is one.
  // When it exists, saving EDITS it instead of creating a duplicate column.
  const existingColumn = useMemo(() => {
    if (!attendanceAssessment || !date) return null;
    return (attendanceAssessment.columns || []).find(c => toDateInputValue(c.date) === date) || null;
  }, [attendanceAssessment, date]);

  // Sync editable config on period change, and (re)load recorded statuses
  // whenever the period/date/column combination changes — render-time
  // adjustment per React docs.
  const deriveKey = `${selectedPeriodId}|${date}|${existingColumn?.id ?? 'new'}|${scores ? 1 : 0}`;
  const [prevDeriveKey, setPrevDeriveKey] = useState(null);
  if (deriveKey !== prevDeriveKey) {
    const prevPeriodPart = prevDeriveKey ? prevDeriveKey.split('|')[0] : null;
    setPrevDeriveKey(deriveKey);
    if (prevPeriodPart !== String(selectedPeriodId) && selectedPeriod?.attendanceConfig) {
      setConfig({
        present_score: selectedPeriod.attendanceConfig.present_score,
        late_score: selectedPeriod.attendanceConfig.late_score,
        absent_score: selectedPeriod.attendanceConfig.absent_score,
      });
    }
    if (existingColumn && scores) {
      // Load the recorded attendance for this date so it can be edited.
      const cfg = selectedPeriod?.attendanceConfig || config;
      const colScores = scores[existingColumn.id] || {};
      const loaded = {};
      for (const s of students) {
        const v = colScores[s.id];
        if (v === undefined || v === null) continue;
        const n = parseFloat(v);
        if (n === parseFloat(cfg.present_score)) loaded[s.id] = 'P';
        else if (n === parseFloat(cfg.late_score)) loaded[s.id] = 'L';
        else if (n === parseFloat(cfg.absent_score)) loaded[s.id] = 'A';
      }
      setStatuses(loaded);
    } else {
      setStatuses({});
    }
  }

  const setStatus = (studentId, status) => {
    setStatuses(prev => ({ ...prev, [studentId]: status }));
  };

  const setAll = (status) => {
    const all = {};
    students.forEach(s => { all[s.id] = status; });
    setStatuses(all);
  };

  // --- Full keyboard workflow ------------------------------------------------
  // ↑/↓ (or Home/End) move the highlight; P / L / A mark the highlighted
  // student and advance to the next one — call the roll without touching the
  // mouse. Keys stay out of the way while typing in the date/config fields.
  useEffect(() => {
    const onKey = (e) => {
      if (!students.length || isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const clamp = (n) => Math.min(students.length - 1, Math.max(0, n));
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(clamp(selIdx + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(clamp(selIdx - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); setSelIdx(0); }
      else if (e.key === 'End') { e.preventDefault(); setSelIdx(students.length - 1); }
      else {
        const status = { p: 'P', l: 'L', a: 'A' }[e.key.toLowerCase()];
        if (!status) return;
        e.preventDefault();
        const cur = clamp(selIdx);
        setStatuses(prev => ({ ...prev, [students[cur].id]: status }));
        setSelIdx(clamp(cur + 1)); // stay in flow: next student is ready
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [students, selIdx]);

  // Keep the highlighted student in view while arrowing through a long roster.
  useEffect(() => {
    document.querySelector(`[data-att-row="${selIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selIdx]);

  const saveConfig = async () => {
    await fetch(`/api/attendance/${selectedPeriodId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const periodsRes = await fetch(`/api/subjects/${id}/periods`);
    setPeriods(await periodsRes.json());
    setToast({ msg: 'Config saved', type: 'success', k: Date.now() });
  };

  const handleSave = async () => {
    if (!attendanceAssessmentId) {
      setToast({ msg: 'No Attendance assessment found in this period.', type: 'error', k: Date.now() });
      return;
    }
    if (!date) {
      setToast({ msg: 'Pick a date first.', type: 'error', k: Date.now() });
      return;
    }
    setSaving(true);
    try {
      // Reuse the existing column for this date, or create it if the date is
      // new. Duplicate columns for the same date can never be created.
      let columnId = existingColumn?.id;
      if (!columnId) {
        const colRes = await fetch(`/api/assessments/${attendanceAssessmentId}/columns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, max_score: config.present_score, dedupe_by_date: true }),
        });
        const colJson = await colRes.json().catch(() => ({}));
        if (!colRes.ok || !colJson?.id) throw new Error(colJson?.error || 'Could not create the attendance column.');
        columnId = colJson.id;
      } else {
        // Keep the existing column's max score in sync with the Present score.
        await fetch(`/api/columns/${columnId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_score: config.present_score }),
        });
      }

      const scoreMap = { P: config.present_score, L: config.late_score, A: config.absent_score };
      const entries = students.map(s => ({
        student_id: s.id,
        value: statuses[s.id] ? scoreMap[statuses[s.id]] : null,
      }));

      const saveRes = await fetch(`/api/attendance/${selectedPeriodId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId, entries }),
      });
      if (!saveRes.ok) throw new Error('Could not save attendance.');

      // The save is already committed — return to the gradebook IMMEDIATELY
      // (the new attendance column being visible IS the confirmation; the
      // old 1.2s toast delay just made a fast save feel slow).
      router.push(`/subjects/${id}`);
    } catch (err) {
      setToast({ msg: err.message, type: 'error', k: Date.now() });
    } finally {
      setSaving(false);
    }
  };

  const presentCount = Object.values(statuses).filter(s => s === 'P').length;
  const lateCount = Object.values(statuses).filter(s => s === 'L').length;
  const absentCount = Object.values(statuses).filter(s => s === 'A').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link href={`/subjects/${id}`} className="text-gray-400 hover:text-gray-700 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-base font-semibold text-gray-900">Attendance</h1>

        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Grading Period</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedPeriodId}
                onChange={e => setSelectedPeriodId(e.target.value)}
              >
                {periods.map(p => <option key={p.id} value={p.id}>{p.type}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
              <p className={`text-[11px] mt-1 ${existingColumn ? 'text-blue-600' : 'text-gray-400'}`}>
                {existingColumn
                  ? `Attendance for ${formatDateMMDDYYYY(date)} already exists — you're editing it.`
                  : 'A new attendance column will be created for this date.'}
              </p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-600 mb-2">Score Mapping</p>
            <div className="grid grid-cols-3 gap-2">
              {[['Present', 'present_score', 'text-green-700'], ['Late', 'late_score', 'text-yellow-600'], ['Absent', 'absent_score', 'text-red-600']].map(([label, key, textColor]) => (
                <div key={key}>
                  <label className={`block text-xs font-medium mb-1 ${textColor}`}>{label}</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={config[key]}
                    onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                    onBlur={saveConfig}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="text-green-600 font-medium">P: {presentCount}</span>
              <span className="text-yellow-600 font-medium">L: {lateCount}</span>
              <span className="text-red-600 font-medium">A: {absentCount}</span>
              <span className="hidden sm:inline text-[10px] text-gray-300">↑↓ move · P L A mark</span>
            </div>
            <div className="flex gap-1">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setAll(opt.key)}
                  className={`text-xs px-2 py-1 border rounded transition-colors ${opt.color}`}
                >
                  All {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {students.map((student, idx) => (
              <div
                key={student.id}
                data-att-row={idx}
                onClick={() => setSelIdx(idx)}
                className={`flex items-center px-5 py-2.5 gap-4 ${
                  selIdx === idx ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : 'hover:bg-gray-50/50'
                }`}
              >
                <span className="text-xs text-gray-400 w-6 shrink-0">{idx + 1}</span>
                <span className="flex-1 text-sm text-gray-800">
                  {displayName(student)}
                </span>
                <div className="flex gap-1">
                  {STATUS_OPTIONS.map(opt => {
                    const active = statuses[student.id] === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setStatus(student.id, opt.key)}
                        className={`text-xs px-2.5 py-1 border rounded transition-colors ${active ? opt.activeColor : opt.color}`}
                      >
                        {opt.key}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Link href={`/subjects/${id}`} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : existingColumn ? 'Update Attendance' : 'Save Attendance'}
          </button>
        </div>
      </main>

      {toast && <Toast key={toast.k} message={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
