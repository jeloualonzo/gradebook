'use client';
import { useCallback } from 'react';

const DEBOUNCE_MS = 400;

// Pending debounced saves — MODULE-level so Ctrl+S (GlobalShortcuts) can
// flush every queued save at once, app-wide. Keys are unique per field
// (score cells use `${columnId}-${studentId}`), so entries never collide.
const pending = new Map(); // key → { timer, fn, onError }

function runNow(key) {
  const entry = pending.get(key);
  if (!entry) return Promise.resolve();
  clearTimeout(entry.timer);
  pending.delete(key);
  return (async () => {
    try {
      await entry.fn();
    } catch (err) {
      console.error('Autosave failed:', err);
      entry.onError?.(err);
    }
  })();
}

export function useAutosave() {
  // Debounced background save. `onError` (optional) is called if the save
  // fails, so callers can roll back their optimistic UI update.
  return useCallback((key, fn, onError) => {
    const existing = pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => runNow(key), DEBOUNCE_MS);
    pending.set(key, { timer, fn, onError });
  }, []);
}

/**
 * Run every pending debounced save immediately (Ctrl+S). Resolves when all
 * of them have finished — failures roll back via each entry's own onError,
 * exactly as they would have when the debounce timer fired.
 */
export function flushAutosaves() {
  return Promise.all([...pending.keys()].map(runNow));
}
