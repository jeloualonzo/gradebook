'use client';
import { useState, useEffect } from 'react';
import { useHotkey } from '@/lib/hooks/useHotkey';
import { flushAutosaves } from '@/lib/hooks/useAutosave';
import Toast from './Toast';

/**
 * App-wide keyboard shortcuts, mounted once in the root layout.
 * Page-specific shortcuts (Ctrl+F in the gradebook, F2 on lists, the
 * attendance keys) live with their pages via the same useHotkey hook.
 *
 * Ctrl+S — save on demand. Autosave already persists everything within
 * ~400ms, but reaching for Ctrl+S is desktop muscle memory. It commits the
 * gradebook field being edited (blur commits, like leaving a cell in Excel),
 * flushes every pending debounced save immediately, and confirms with a toast.
 */
export default function GlobalShortcuts() {
  const [savedToast, setSavedToast] = useState(null);

  // Mouse wheel must NEVER change a grade (v1.7.0). Chromium spins a
  // focused number input on wheel — and a gradebook cell is almost always
  // focused. One app-wide capture listener kills the spin at the event
  // level and manually forwards the scroll to the nearest scrollable
  // ancestor (modal bodies scroll themselves; the page scrolls otherwise),
  // so scrolling still FEELS native. Numeric inputs keep their semantics.
  useEffect(() => {
    const scrollParentOf = (el) => {
      for (let n = el?.parentElement; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
      }
      return null;
    };
    const onWheel = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'number') return;
      if (document.activeElement !== t) return; // unfocused inputs never spin anyway
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
      const scroller = scrollParentOf(t);
      if (scroller) scroller.scrollBy(0, dy);
      else window.scrollBy(0, dy);
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  useHotkey('ctrl+s', async (e) => {
    e.preventDefault(); // never the browser's save-page dialog
    const el = document.activeElement;
    // Commit the in-grid edit under the cursor (name/weight/date/max/score
    // all save on blur). Fields elsewhere (search boxes…) are left alone.
    if (el && el.closest?.('.gradebook-table')) el.blur();
    await flushAutosaves();
    setSavedToast({ key: Date.now() });
  }, { allowInInputs: true });

  if (!savedToast) return null;
  return (
    <Toast
      key={savedToast.key}
      message="✓ All changes saved"
      type="success"
      onDone={() => setSavedToast(null)}
    />
  );
}
