'use client';
import { useEffect, useRef } from 'react';

/**
 * Central keyboard-shortcut plumbing — ONE way to add shortcuts everywhere.
 *
 *   useHotkey('ctrl+f', (e) => { ... }, { allowInInputs: true });
 *   useHotkey('f2',     (e) => { ... });
 *
 * Design:
 * - Combos are plain strings: 'ctrl+s', 'f2', 'ctrl+shift+p', 'escape'.
 *   Modifiers are matched EXACTLY ('f2' will not fire on Ctrl+F2), so new
 *   shortcuts can never shadow each other by accident.
 * - By default a shortcut does NOT fire while the user is typing in a
 *   field — pass { allowInInputs: true } for shortcuts that must work
 *   everywhere (Ctrl+S, Ctrl+F).
 * - The handler lives in a ref, so callers can pass a fresh closure every
 *   render without re-registering listeners.
 *
 * App-wide shortcuts are mounted once in GlobalShortcuts (root layout);
 * page-specific ones live with their pages via this same hook.
 */

/** True when the element is a place where the user types. */
export function isTypingTarget(el) {
  if (!el || !el.closest) return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function matchesCombo(e, combo) {
  const parts = String(combo).toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  if (mods.has('ctrl') !== (e.ctrlKey || e.metaKey)) return false;
  if (mods.has('shift') !== e.shiftKey) return false;
  if (mods.has('alt') !== e.altKey) return false;
  return String(e.key).toLowerCase() === key;
}

export function useHotkey(combo, handler, { enabled = true, allowInInputs = false } = {}) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      if (!matchesCombo(e, combo)) return;
      if (!allowInInputs && isTypingTarget(e.target)) return;
      handlerRef.current(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo, enabled, allowInInputs]);
}
