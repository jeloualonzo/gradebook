'use client';
import { useState } from 'react';
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
