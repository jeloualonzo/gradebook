'use client';
import Link from 'next/link';
import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

/** Card for one Student Group — mirrors SubjectCard's look and actions. */
export default function GroupCard({ group, onEdit, onDelete, onDuplicate }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const count = Number(group.student_count) || 0;

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-blue-300 hover:shadow-sm transition-all group">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/groups/${group.id}`} className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-700 transition-colors">
              {group.name}
            </h3>
          </Link>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onDuplicate}
              title="Duplicate"
              className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
            <button
              onClick={onEdit}
              title="Edit"
              className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              title="Delete"
              className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </button>
          </div>
        </div>

        <Link href={`/groups/${group.id}`} className="block space-y-2">
          {group.description ? (
            <p className="text-xs text-gray-500 line-clamp-2">{group.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
              {count} student{count !== 1 ? 's' : ''}
            </span>
          </div>
        </Link>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onDelete}
        title="Delete Student Group"
        message={`Delete "${group.name}"? Subjects that already imported these students are NOT affected.`}
      />
    </>
  );
}
