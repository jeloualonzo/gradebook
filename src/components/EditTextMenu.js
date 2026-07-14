'use client';
import { useState, useEffect, useCallback } from 'react';
import ContextMenu from './ContextMenu';

/**
 * The edit context menu for ordinary text fields (v1.7.0) — Undo · Redo ·
 * Cut · Copy · Paste · Delete · Select All, exactly what every Windows app
 * offers on right-click in a text box. Electron ships NO default editable
 * menu, so fields felt web-ish; drawing our own (the VS Code approach)
 * works identically in the desktop shell and browser dev mode and matches
 * the app's menu aesthetic.
 *
 * Mounted once in the root layout. It only fires when nothing else claimed
 * the right-click (every custom menu in the app calls preventDefault), and
 * never inside the gradebook grid — grid cells own their range menu.
 */
export default function EditTextMenu() {
  const [menu, setMenu] = useState(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (e) => {
      if (e.defaultPrevented) return; // a custom app menu owns this click
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (t instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit'].includes(t.type)) return;
      if (t.readOnly || t.disabled) return;
      if (t.closest('.gradebook-table')) return; // grid cells have their own menu
      e.preventDefault();
      t.focus();

      const hasSelection = t.selectionStart !== t.selectionEnd;
      // React-safe value injection: set through the native setter, then fire
      // an input event so controlled components see the change.
      const setValue = (next, caret) => {
        const proto = t instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, next);
        t.dispatchEvent(new Event('input', { bubbles: true }));
        if (caret !== undefined) t.setSelectionRange(caret, caret);
      };
      const replaceSelection = (text) => {
        const s = t.selectionStart;
        const epos = t.selectionEnd;
        setValue(t.value.slice(0, s) + text + t.value.slice(epos), s + text.length);
      };

      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          // execCommand still drives the input's NATIVE undo stack — which
          // is exactly what "undo like Notepad" means.
          { label: 'Undo', onClick: () => { t.focus(); document.execCommand('undo'); } },
          { label: 'Redo', onClick: () => { t.focus(); document.execCommand('redo'); } },
          ...(hasSelection ? [
            { label: 'Cut', separatorBefore: true, onClick: () => { t.focus(); document.execCommand('cut'); } },
            { label: 'Copy', onClick: () => { t.focus(); document.execCommand('copy'); } },
          ] : []),
          {
            label: 'Paste',
            separatorBefore: !hasSelection,
            onClick: () => {
              t.focus();
              navigator.clipboard?.readText?.()
                .then(text => { if (text) replaceSelection(text.replace(/\r?\n/g, ' ')); })
                .catch(() => { /* clipboard unavailable — Ctrl+V still works */ });
            },
          },
          ...(hasSelection ? [{ label: 'Delete', onClick: () => { t.focus(); replaceSelection(''); } }] : []),
          { label: 'Select All', separatorBefore: true, onClick: () => { t.focus(); t.select(); } },
        ],
      });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return <ContextMenu menu={menu} onClose={closeMenu} />;
}
