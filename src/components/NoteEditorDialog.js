'use client';
import { useState } from 'react';
import Modal from './Modal';

/**
 * The note editor (v1.8.0) — Excel's comment box, sized for a class record.
 * One dialog is the whole lifecycle: Add (empty), Edit/View (existing text),
 * Delete (existing only). Multi-line; Ctrl+Enter saves (plain Enter inserts
 * a newline — notes are prose); Escape closes via the Modal.
 *
 * target: { title, subtitle, initialBody, exists }
 * onSave(body) / onDelete() / onClose() — persistence, history entries, and
 * toasts live with the page (notes SYNC, so writes ride the normal pipeline).
 */
export default function NoteEditorDialog({ target, onSave, onDelete, onClose }) {
  const [body, setBody] = useState(target.initialBody || '');
  const trimmed = body.trim();
  const canSave = trimmed.length > 0 && trimmed !== String(target.initialBody || '').trim();

  const save = () => { if (canSave) onSave(trimmed); };

  return (
    <Modal open onClose={onClose} title={target.exists ? 'Edit Note' : 'Add Note'} width="max-w-sm">
      <p className="text-xs text-gray-500 mb-2 truncate" title={target.subtitle}>{target.subtitle}</p>
      <textarea
        data-autofocus
        rows={5}
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
        }}
        placeholder="e.g. Quiz postponed — class suspension; makeup on Friday."
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y whitespace-pre-wrap"
      />
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] text-gray-400">Ctrl+Enter saves · notes sync between laptops</span>
        <div className="flex items-center gap-2">
          {target.exists && (
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Note
          </button>
        </div>
      </div>
    </Modal>
  );
}
