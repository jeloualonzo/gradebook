'use client';
import { useEffect } from 'react';
import { cycleCase } from '@/lib/textCase';

/**
 * Word-style Shift+F3 in EVERY text box, app-wide: cycles the focused
 * input's text through UPPERCASE → lowercase → Title Case. If part of the
 * text is selected, only the selection is transformed.
 *
 * Works with React-controlled inputs: the value is set through the native
 * setter and an `input` event is dispatched, so onChange handlers fire and
 * component state stays in sync.
 */
export default function CaseShortcut() {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'F3' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const isText =
        (el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type || 'text')) ||
        el instanceof HTMLTextAreaElement;
      if (!isText || el.readOnly || el.disabled) return;
      e.preventDefault();

      const { value, selectionStart, selectionEnd } = el;
      const hasSelection = selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart;
      const from = hasSelection ? selectionStart : 0;
      const to = hasSelection ? selectionEnd : value.length;
      const next = value.slice(0, from) + cycleCase(value.slice(from, to)) + value.slice(to);
      if (next === value) return;

      // Native setter + input event → React onChange fires normally.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.setSelectionRange(from, to); // keep the selection for repeated presses
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
