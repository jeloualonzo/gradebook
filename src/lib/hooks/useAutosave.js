'use client';
import { useRef, useCallback } from 'react';

const DEBOUNCE_MS = 400;

export function useAutosave() {
  const timers = useRef({});

  // Debounced background save. `onError` (optional) is called if the save
  // fails, so callers can roll back their optimistic UI update.
  const save = useCallback((key, fn, onError) => {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      delete timers.current[key];
      try {
        await fn();
      } catch (err) {
        console.error('Autosave failed:', err);
        onError?.(err);
      }
    }, DEBOUNCE_MS);
  }, []);

  return save;
}
