'use client';
import { useRef, useCallback } from 'react';

const DEBOUNCE_MS = 400;

export function useAutosave() {
  const timers = useRef({});

  const save = useCallback((key, fn) => {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      await fn();
      delete timers.current[key];
    }, DEBOUNCE_MS);
  }, []);

  return save;
}
