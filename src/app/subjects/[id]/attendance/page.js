'use client';
import { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Toast from '@/components/Toast';

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
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [statuses, setStatuses] = useState({});
  const [config, setConfig] = useState({ present_score: 10, late_score: 8, absent_score: 0 });
  const [attendanceAssessmentId, setAttendanceAssessmentId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    async function load() {
      const [periodsRes, studentsRes] = await Promise.all([
        fetch(`/api/subjects/${id}/periods`),
        fetch(`/api/subjects/${id}/students`),
      ]);
      const periodsData = await periodsRes.json();
      const studentsData = await studentsRes.json();
      setPeriods(periodsData);
      setStudents(studentsData);

      if (!selectedPeriodId && periodsData.length > 0) {
        setSelectedPeriodId(String(periodsData[0].id));
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!selectedPeriodId) return;
    const period = periods.find(p => String(p.id) === String(selectedPeriodId));
    if (!period) return;

    if (period.attendanceConfig) {
      setConfig({
        present_score: period.attendanceConfig.present_score,
        late_score: period.attendanceConfig.late_score,
        absent_score: period.attendanceConfig.absent_score,
      });
    }

    const attAssessment = period.assessments?.find(a => a.name.toLowerCase() === 'attendance');
    setAttendanceAssessmentId(attAssessment?.id || null);

    setStatuses({});
  }, [selectedPeriodId, periods]);

  const setStatus = (studentId, status) => {
    setStatuses(prev => ({ ...prev, [studentId]: status }));
  };

  const setAll = (status) => {
    const all = {};
    students.forEach(s => { all[s.id] = status; });
    setStatuses(all);
  };

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
    setSaving(true);

    const colRes = await fetch(`/api/assessments/${attendanceAssessmentId}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, max_score: config.present_score }),
    });
    const { id: columnId } = await colRes.json();

    const scoreMap = { P: config.present_score, L: config.late_score, A: config.absent_score };
    const entries = students.map(s => ({
      student_id: s.id,
      value: statuses[s.id] ? scoreMap[statuses[s.id]] : null,
    }));

    await fetch(`/api/attendance/${selectedPeriodId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, entries }),
    });

    setSaving(false);
    setToast({ msg: 'Attendance saved to gradebook', type: 'success', k: Date.now() });
    setTimeout(() => router.push(`/subjects/${id}`), 1200);
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
          <p className="text-xs text-gray-500">Quick entry</p>
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
              <div key={student.id} className="flex items-center px-5 py-2.5 gap-4 hover:bg-gray-50/50">
                <span className="text-xs text-gray-400 w-6 shrink-0">{idx + 1}</span>
                <span className="flex-1 text-sm text-gray-800">
                  {student.last_name}, {student.first_name}
                  {student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}
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
            {saving ? 'Saving…' : 'Save Attendance'}
          </button>
        </div>
      </main>

      {toast && <Toast key={toast.k} message={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
