'use client';
import { createContext, useContext } from 'react';
import { defaultHighlightConfig, normalizeHighlightConfig } from './highlights';

/**
 * Client-side plumbing for the highlight rules (v1.8.0): device-local
 * persistence + the context that carries the config into memoized cells.
 * Coloring is a VIEWING preference — per device, never synced (the pure
 * rules live in src/lib/highlights.js).
 */

export const HIGHLIGHTS_KEY = 'gb-highlights';

export function loadHighlightConfig() {
  if (typeof window === 'undefined') return defaultHighlightConfig();
  let raw = null;
  try { raw = JSON.parse(window.localStorage.getItem(HIGHLIGHTS_KEY) || 'null'); } catch { /* corrupt — defaults */ }
  const config = normalizeHighlightConfig(raw);
  if (!raw) {
    // One-time migration: the v1.7.0 missing-highlight toggle becomes the
    // missing RULE's enabled flag (one toggle, one system — still true).
    try {
      if (window.localStorage.getItem('gb-missing-hl') === '0') {
        config.rules.missing = { ...config.rules.missing, enabled: false };
      }
    } catch { /* non-fatal */ }
  }
  return config;
}

export function saveHighlightConfig(config) {
  try { window.localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(config)); } catch { /* non-fatal */ }
}

// Context (not props) so the memoized ScoreCells can read the config without
// a new prop: a config change re-renders every consumer — correct and rare
// (only when the user edits Settings → Cell Coloring or flips a View toggle).
export const HighlightContext = createContext(defaultHighlightConfig());
export const useHighlights = () => useContext(HighlightContext);
