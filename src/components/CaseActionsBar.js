'use client';
import { CASE_MODES } from '@/lib/textCase';

/**
 * Bulk text-case toolbar shown while rows are selected (Excel-style cleanup
 * after imports). One shared component so every list behaves identically.
 */
export default function CaseActionsBar({ count, busy, onApply, onClear }) {
  if (!count) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs mb-2">
      <span className="font-medium text-blue-800">{count} selected</span>
      <span className="text-blue-300">·</span>
      <span className="text-blue-700">Change case:</span>
      {CASE_MODES.map(m => (
        <button
          key={m.id}
          onClick={() => onApply(m.id)}
          disabled={busy}
          className="px-2 py-1 bg-white border border-blue-200 rounded-md text-blue-800 hover:bg-blue-100 disabled:opacity-50 font-medium"
        >
          {m.label}
        </button>
      ))}
      <span className="flex-1" />
      <button onClick={onClear} disabled={busy} className="text-blue-400 hover:text-blue-700 px-1" title="Clear selection">✕</button>
    </div>
  );
}
