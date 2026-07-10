'use client';
import { useEffect } from 'react';

const BASE_TITLE = 'Faculty Gradebook';

/**
 * Dynamic window title — makes Alt+Tab and the Windows taskbar meaningful.
 *
 *   usePageTitle('GE 3 Living in the IT Era — BSIS 3A — PRELIM')
 *   → window title: "GE 3 Living in the IT Era — BSIS 3A — PRELIM — Faculty Gradebook"
 *
 * In the desktop shell the Electron window title follows document.title
 * automatically. Pass null/'' while data is still loading — the base title
 * shows until the real one is known.
 */
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${BASE_TITLE}` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [title]);
}
