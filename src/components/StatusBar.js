'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Slim desktop-style status bar, fixed at the bottom of every page.
 *
 * Left:  Settings (always reachable, never competing with primary actions)
 *        + an amber dot when synchronization needs a look.
 * Right: laptop name · app version — quiet identity/status information.
 *
 * This is also the natural future home for an "Update available" badge.
 */
export default function StatusBar() {
  const pathname = usePathname();
  const [info, setInfo] = useState(null); // { device_label, version }
  const [attention, setAttention] = useState(false);
  const [conflicts, setConflicts] = useState(0); // unreviewed sync conflicts
  const [update, setUpdate] = useState(null); // desktop only

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [devRes, syncRes] = await Promise.all([fetch('/api/device'), fetch('/api/sync')]);
        const dev = await devRes.json();
        const sync = await syncRes.json();
        if (!alive) return;
        if (devRes.ok) setInfo(dev);
        if (syncRes.ok) {
          setConflicts(sync.unreviewed_conflicts || 0);
          setAttention(!!(
            sync.sync_folder &&
            (sync.folder_problem || (sync.peers || []).some(p => p.clock_skew_minutes))
          ));
        }
        const u = await window.gradebookDesktop?.updateStatus?.();
        if (u && alive) setUpdate(u);
      } catch {
        /* non-fatal */
      }
    };
    refresh();
    const t = setInterval(refresh, 60000); // keep the badge fresh while idle
    return () => { alive = false; clearInterval(t); };
  }, [pathname]); // refresh when navigating between pages

  const updateReady = update?.state === 'downloaded';
  const updateBusy = update?.state === 'downloading';

  // Grading stays distraction-free: no status bar inside the gradebook or
  // the quick-attendance page (/subjects/[id]…). Creating a subject
  // (/subjects/new) keeps it.
  if (/^\/subjects\/[^/]+/.test(pathname) && pathname !== '/subjects/new') return null;

  return (
    <>
    <div className="h-9" aria-hidden="true" /> {/* in-flow spacer so content never hides behind the fixed bar */}
    <div className="fixed bottom-0 inset-x-0 h-9 bg-white border-t border-gray-200 flex items-center justify-between px-4 z-40 text-xs">
      <Link
        href={conflicts > 0 ? '/settings?tab=conflicts' : '/settings'}
        title={conflicts > 0
          ? `${conflicts} sync conflict${conflicts !== 1 ? 's' : ''} to review`
          : attention ? 'Settings — sync needs attention' : 'Settings'}
        className={`relative flex items-center gap-1.5 font-medium ${pathname === '/settings' ? 'text-blue-700' : 'text-gray-500 hover:text-gray-800'}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
        Settings
        {/* Unreviewed-conflict count beats the plain attention dot. */}
        {conflicts > 0 ? (
          <span className="min-w-[16px] h-4 px-1 text-[10px] font-bold leading-4 text-center text-white bg-amber-500 rounded-full">
            {conflicts}
          </span>
        ) : (attention || updateReady || updateBusy) && (
          <span className={`absolute -top-0.5 -right-2 w-2 h-2 rounded-full ${attention ? 'bg-amber-500' : 'bg-blue-500'}`} />
        )}
      </Link>
      <div className="flex items-center gap-3 text-gray-400">
        {updateReady && (
          <button
            onClick={() => window.gradebookDesktop?.installUpdate?.()}
            className="px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 rounded-full hover:bg-blue-700"
            title={`Version ${update.version} is downloaded — restart to apply`}
          >
            Update ready — restart
          </button>
        )}
        {updateBusy && <span className="text-blue-600">Downloading update… {update.percent ?? 0}%</span>}
        <span>
          {info?.device_label && <span className="text-gray-500">{info.device_label}</span>}
          {info?.device_label && info?.version && <span className="mx-1.5">·</span>}
          {info?.version && <span>v{info.version}</span>}
        </span>
      </div>
    </div>
    </>
  );
}
