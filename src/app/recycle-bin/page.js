'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The recycle bin moved into Settings → Recently Deleted.
export default function RecycleBinRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/settings?tab=deleted'); }, [router]);
  return null;
}
