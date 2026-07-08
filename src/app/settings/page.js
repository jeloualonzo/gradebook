'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SyncPanel from '@/components/SyncPanel';
import RecycleBinPanel from '@/components/RecycleBinPanel';
import Toast from '@/components/Toast';
import { usePageTitle } from '@/lib/hooks/usePageTitle';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'sync', label: 'Synchronization' },
  { id: 'deleted', label: 'Recently Deleted' },
  { id: 'backups', label: 'Backups' },
];

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-gray-100 last:border-0">
      <div className="text-sm text-gray-600 shrink-0 pt-1">{label}</div>
      <div className="text-sm text-gray-900 text-right min-w-0">{children}</div>
    </div>
  );
}

function GeneralTab({ showToast }) {
  const [info, setInfo] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  // Desktop only: application update state, refreshed while the tab is open.
  const [update, setUpdate] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/device');
        const d = await res.json();
        if (res.ok) { setInfo(d); setName(d.device_label || ''); }
      } catch { /* non-fatal */ }
    })();
  }, []);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.gradebookDesktop : null;
    if (!api?.updateStatus) return;
    let alive = true;
    const poll = async () => {
      try {
        const u = await api.updateStatus();
        if (alive) setUpdate(u);
      } catch { /* non-fatal */ }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const checkNow = async () => {
    const api = window.gradebookDesktop;
    if (!api?.checkForUpdates) return;
    setChecking(true);
    try { setUpdate(await api.checkForUpdates()); } finally { setChecking(false); }
  };

  const installNow = async () => {
    const ok = await window.gradebookDesktop?.installUpdate?.();
    if (!ok) showToast('The update is not ready yet.', 'error');
    // On success the app syncs, quits, and the installer takes over.
  };

  const updateRow = (() => {
    if (!update) return null; // browser mode — updates are a desktop concern
    const btn = (label, onClick, primary = false) => (
      <button
        onClick={onClick}
        disabled={checking}
        className={primary
          ? 'px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50'
          : 'px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50'}
      >
        {label}
      </button>
    );
    switch (update.state) {
      case 'checking':
        return <span className="text-gray-500">Checking…</span>;
      case 'downloading':
        return <span className="text-blue-700">Downloading v{update.version}… {update.percent ?? 0}%</span>;
      case 'downloaded':
        return (
          <div className="flex items-center gap-2 justify-end">
            <span className="text-green-700">v{update.version} ready</span>
            {btn('Restart and Update', installNow, true)}
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2 justify-end">
            <span className="text-gray-400" title={update.error}>Couldn’t check (offline?)</span>
            {btn(checking ? 'Checking…' : 'Check for Updates', checkNow)}
          </div>
        );
      case 'uptodate':
        return (
          <div className="flex items-center gap-2 justify-end">
            <span className="text-gray-500">Up to date</span>
            {btn(checking ? 'Checking…' : 'Check for Updates', checkNow)}
          </div>
        );
      default:
        return update.packaged
          ? btn(checking ? 'Checking…' : 'Check for Updates', checkNow)
          : <span className="text-gray-400">Available in the installed app</span>;
    }
  })();

  const saveName = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/device', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_label: name }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save the name');
      setInfo(prev => ({ ...prev, device_label: d.device_label }));
      showToast('Laptop name saved.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-2">
      <Row label="Laptop name">
        <div className="flex items-center gap-2 justify-end">
          <input
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={name}
            placeholder={'e.g. Jelou’s laptop'}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
          />
          <button
            onClick={saveName}
            disabled={saving || !name.trim() || name.trim() === (info?.device_label || '')}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Row>
      <Row label="Application version">{info?.version || '—'}</Row>
      {updateRow && <Row label="Updates">{updateRow}</Row>}
      <Row label="Data folder">
        <span className="text-xs text-gray-500 break-all">{info?.data_dir || '—'}</span>
      </Row>
    </div>
  );
}

function BackupsTab() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/backups');
        const d = await res.json();
        if (res.ok) setInfo(d);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const canOpen = typeof window !== 'undefined' && window.gradebookDesktop?.openBackupsFolder;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-lg px-5 py-2">
        <Row label="Automatic backups">
          Every launch, before the gradebook opens · newest {info?.keep ?? 14} kept
        </Row>
        <Row label="Last backup">{fmtWhen(info?.latest_at)}</Row>
        <Row label="Backups on this laptop">{info ? info.count : '—'}</Row>
        {canOpen && (
          <Row label="Backup folder">
            <button
              onClick={() => window.gradebookDesktop.openBackupsFolder()}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Open folder
            </button>
          </Row>
        )}
      </div>
      <p className="text-xs text-gray-400 px-1">
        Each backup is a complete copy of the database from that moment. If anything ever goes badly
        wrong, the newest backup can bring everything back — ask before restoring manually.
      </p>
    </div>
  );
}

function SettingsContent() {
  // Deep-link support: /settings?tab=sync etc.
  const searchParams = useSearchParams();
  const wanted = searchParams.get('tab');
  const [tab, setTab] = useState(TABS.some(t => t.id === wanted) ? wanted : 'general');
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'success') => setToast({ message, type, key: Date.now() }), []);

  usePageTitle('Settings');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <Link href="/" className="text-gray-400 hover:text-gray-700" title="Back to subjects">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'general' && <GeneralTab showToast={showToast} />}
        {tab === 'sync' && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <SyncPanel />
          </div>
        )}
        {tab === 'deleted' && <RecycleBinPanel />}
        {tab === 'backups' && <BackupsTab />}
      </main>

      {toast && <Toast key={toast.key} message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

// useSearchParams requires a Suspense boundary for static prerendering.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
