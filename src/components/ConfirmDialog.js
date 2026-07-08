'use client';
import Modal from './Modal';

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm">
      <p className="text-sm text-gray-600 mb-6">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          // Focused when the dialog opens (via Modal), so Enter confirms and
          // Esc cancels — standard desktop dialog keys. Deletes stay safe:
          // they go to the recycle bin, not oblivion.
          data-autofocus
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
            danger ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-400'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
