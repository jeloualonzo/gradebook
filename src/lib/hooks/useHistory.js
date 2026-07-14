'use client';
import { useRef, useCallback, useEffect, useState } from 'react';

/**
 * Spreadsheet-style undo/redo history (Ctrl+Z / Ctrl+Y, like Excel/Sheets).
 *
 * Each history entry is a command object:
 *   { label: string, undo: async fn, redo: async fn }
 * where undo/redo perform the inverse/original API calls AND refresh local
 * state, so the UI and the database always stay in sync.
 *
 * Notes:
 * - A new action clears the redo stack (standard spreadsheet behavior).
 * - History is per-session: it clears on page reload.
 * - Ctrl+Shift+Z and Cmd+Z / Cmd+Shift+Z (macOS) are also supported.
 */
export function useHistory({ onNotify } = {}) {
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const busy = useRef(false);
  // Stack sizes mirrored into state so canUndo/canRedo update the UI.
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });

  const onNotifyRef = useRef(onNotify);
  useEffect(() => { onNotifyRef.current = onNotify; });

  const bump = useCallback(() => {
    setCounts({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, []);

  const push = useCallback((entry) => {
    undoStack.current.push(entry);
    redoStack.current = [];
    bump();
  }, [bump]);

  const undo = useCallback(async () => {
    if (busy.current) return;
    const entry = undoStack.current.pop();
    if (!entry) return;
    busy.current = true;
    bump();
    try {
      await entry.undo();
      redoStack.current.push(entry);
      onNotifyRef.current?.(`Undo: ${entry.label}`, 'success');
    } catch (err) {
      console.error('Undo failed:', err);
      onNotifyRef.current?.(`Undo failed: ${entry.label}`, 'error');
    } finally {
      busy.current = false;
      bump();
    }
  }, [bump]);

  const redo = useCallback(async () => {
    if (busy.current) return;
    const entry = redoStack.current.pop();
    if (!entry) return;
    busy.current = true;
    bump();
    try {
      await entry.redo();
      undoStack.current.push(entry);
      onNotifyRef.current?.(`Redo: ${entry.label}`, 'success');
    } catch (err) {
      console.error('Redo failed:', err);
      onNotifyRef.current?.(`Redo failed: ${entry.label}`, 'error');
    } finally {
      busy.current = false;
      bump();
    }
  }, [bump]);

  // Global keyboard shortcuts: Ctrl+Z → undo, Ctrl+Y / Ctrl+Shift+Z → redo.
  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      // The undo split (v1.7.0): ORDINARY text fields — names, titles,
      // settings, search boxes — keep the browser's native character-level
      // Ctrl+Z/Y, exactly like Notepad/Office. GRID cells keep the Excel
      // session model: their edits commit as history entries, so app undo
      // is the right response there (the shipped Phase 2 contract).
      const editable = e.target?.closest?.('input, textarea, [contenteditable="true"]');
      if (editable && !editable.closest('.gradebook-table')) return;
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return {
    push,
    undo,
    redo,
    canUndo: counts.undo > 0,
    canRedo: counts.redo > 0,
  };
}
