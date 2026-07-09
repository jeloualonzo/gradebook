'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Watches for sync conflicts resolved by AUTOMATIC syncs (startup, the
 * 5-minute background pass, and last session's shutdown sync) and surfaces
 * them as a persistent toast:
 *
 *   Synchronization complete — 3 conflicting edits were resolved
 *   automatically.  [Review] [Dismiss]
 *
 * Synchronization itself never stops or asks questions — this only reports
 * afterwards. Mounted once in the root layout; polls the cheap status
 * endpoint and re-checks on window focus and navigation.
 *
 * Dismissal is remembered (localStorage) as "acknowledged up to N", so the
 * same conflicts never re-toast — but any NEW conflict raises it again.
 * Conflicts logged by the shutdown sync surface here on the next launch.
 */
const ACK_KEY = 'gb-conflicts-acknowledged';

export default function ConflictWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(0); // unreviewed count the toast reports
  const ackRef = useRef(null); // null until localStorage is read

  useEffect(() => {
    let alive = true;
    if (ackRef.current === null) {
      const saved = parseInt(window.localStorage.getItem(ACK_KEY), 10);
      ackRef.current = Number.isFinite(saved) && saved >= 0 ? saved : 0;
    }
    const ack = (n) => {
      ackRef.current = n;
      try { window.localStorage.setItem(ACK_KEY, String(n)); } catch { /* private mode */ }
    };
    const poll = async () => {
      try {
        const res = await fetch('/api/sync');
        const d = await res.json();
        if (!alive || !res.ok) return;
        const n = d.unreviewed_conflicts || 0;
        // Reviewed (here or via the panel) — lower the watermark so the
        // next genuinely new conflict notifies again.
        if (n < ackRef.current) ack(n);
        setPending(n > ackRef.current ? n : 0);
      } catch { /* server starting / offline — try again later */ }
    };
    poll();
    const timer = setInterval(poll, 45000);
    window.addEventListener('focus', poll);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [pathname]);

  const acknowledge = () => {
    ackRef.current = Math.max(ackRef.current || 0, pending);
    try { window.localStorage.setItem(ACK_KEY, String(ackRef.current)); } catch { /* private mode */ }
    setPending(0);
  };

  // Already looking at Settings (the review tab lives there) — stay quiet.
  if (!pending || pathname === '/settings') return null;

  return (
    <div className="fixed bottom-12 right-4 z-[90] w-80 bg-white border border-amber-300 rounded-xl shadow-xl p-4">
      <div className="flex items-start gap-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0 mt-0.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Synchronization complete</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
            {pending} conflicting edit{pending !== 1 ? 's were' : ' was'} resolved automatically
            (newest kept). Nothing was lost — both versions are saved.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { acknowledge(); router.push('/settings?tab=conflicts'); }}
              className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
            >
              Review
            </button>
            <button
              onClick={acknowledge}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
