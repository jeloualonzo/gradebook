'use client';
import { useEffect, useState } from 'react';

export default function Toast({ message, type = 'success', onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onDone?.(); }, 2500);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const colors = {
    success: 'bg-gray-800 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white',
  };

  return (
    <div className={`fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg ${colors[type]}`}>
      {message}
    </div>
  );
}
