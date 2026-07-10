'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Open modals, in mount order. Only the TOPMOST dialog handles Escape and
// traps Tab — so a confirm dialog stacked over another modal behaves like
// nested dialogs do in native Windows apps (Esc closes one layer at a time).
const modalStack = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  const ref = useRef(null);

  // Desktop dialog conventions: focus moves INTO the dialog when it opens
  // ([data-autofocus] first, else the first field), Tab cycles only within
  // it (focus trap), Escape closes the top dialog, and focus returns to
  // where it was when the dialog closes.
  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    modalStack.push(token);
    const isTop = () => modalStack[modalStack.length - 1] === token;
    const previouslyFocused = document.activeElement;

    const focusables = () =>
      Array.from(ref.current?.querySelectorAll(FOCUSABLE) || [])
        .filter(el => el.offsetParent !== null); // visible only

    // Initial focus — never steal it from a child that autofocused itself.
    const raf = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root || root.contains(document.activeElement)) return;
      const target =
        root.querySelector('[data-autofocus]') ||
        focusables().find(el => !el.hasAttribute('data-modal-close'));
      target?.focus();
    });

    const handleKey = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const current = document.activeElement;
      const inside = ref.current?.contains(current);
      if (e.shiftKey && (current === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKey);
      const i = modalStack.indexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
      // Hand focus back where it was (if that element still exists).
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus?.();
      }
    };
  }, [open, onClose]);

  if (!open) return null;
  // Modals open only via user interaction, so document always exists here —
  // this guard just keeps server rendering safe.
  if (typeof document === 'undefined') return null;

  // Rendered through a PORTAL to <body>: a modal can be triggered from
  // anywhere — including inside table rows (e.g. the delete-column dialog in
  // the gradebook header) — without producing invalid HTML like a <div>
  // inside <tr>, which breaks hydration in React 19.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 gb-fade-in"
        onClick={onClose}
      />
      <div
        ref={ref}
        className={`relative z-10 bg-white rounded-xl shadow-xl w-full ${width} mx-4 max-h-[90vh] flex flex-col gb-modal-in`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            data-modal-close
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
