'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Right-click context menu (desktop-app style).
 *
 * `menu` is null (closed) or:
 *   {
 *     x, y,                    // viewport coordinates from the contextmenu event
 *     items: [{ label, onClick, danger?, disabled?, separatorBefore? }],
 *   }
 *
 * Rendered through a portal to <body> so it can be triggered from anywhere —
 * including table cells — without invalid-nesting issues, and it closes on
 * click-away, Escape, scroll, resize, or a right-click elsewhere.
 *
 * Keyboard works like a native Windows menu: ↑/↓ move the highlight
 * (skipping disabled items, wrapping at the ends), Enter activates, Esc
 * closes. Mouse hover moves the same highlight, so the two stay in sync.
 */
export default function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const [active, setActive] = useState(-1);

  const items = (menu?.items || []).filter(Boolean);
  // Fresh values for the (single) listener effect below.
  const itemsRef = useRef(items);
  const activeRef = useRef(active);
  useEffect(() => { itemsRef.current = items; activeRef.current = active; });

  // New menu → no highlight until the keyboard or mouse says otherwise.
  // Render-time adjustment per the React docs (not an effect).
  const [prevMenu, setPrevMenu] = useState(menu);
  if (prevMenu !== menu) {
    setPrevMenu(menu);
    setActive(-1);
  }

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose();
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      const list = itemsRef.current;
      const enabled = list.map((it, i) => (it.disabled ? -1 : i)).filter(i => i >= 0);
      if (enabled.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const pos = enabled.indexOf(activeRef.current);
        const next = pos === -1
          ? (dir === 1 ? enabled[0] : enabled[enabled.length - 1])
          : enabled[(pos + dir + enabled.length) % enabled.length];
        setActive(next);
      } else if (e.key === 'Enter') {
        const item = list[activeRef.current];
        if (!item || item.disabled) return;
        e.preventDefault();
        onClose();
        item.onClick?.();
      }
    };
    const onPointer = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      onClose();
    };
    // Delay listener registration so the opening right-click itself doesn't close it.
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onPointer);
      window.addEventListener('contextmenu', onPointer);
      window.addEventListener('keydown', onKey);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('contextmenu', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, onClose]);

  if (!menu || typeof document === 'undefined') return null;

  const MENU_W = 200;
  const approxH = items.length * 32 + items.filter(i => i.separatorBefore).length * 9 + 12;
  const x = Math.min(menu.x, (window.innerWidth || 1200) - MENU_W - 8);
  const y = Math.min(menu.y, (window.innerHeight || 800) - approxH - 8);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] bg-white border border-gray-200 rounded-lg shadow-xl py-1.5"
      style={{ left: Math.max(4, x), top: Math.max(4, y), width: MENU_W }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className="my-1.5 border-t border-gray-100" />}
          <button
            type="button"
            disabled={item.disabled}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(a => (a === i ? -1 : a))}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
            className={`w-full text-left px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              item.danger
                ? `text-red-600 ${active === i ? 'bg-red-50' : ''}`
                : `text-gray-700 ${active === i ? 'bg-gray-50' : ''}`
            }`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
