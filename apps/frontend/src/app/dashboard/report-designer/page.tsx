'use client';

// The report designer now lives as a tab inside the Reports page.
// This route is kept as a redirect so existing bookmarks/deep-links don't 404.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ReportDesignerRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/reports?tab=designer'); }, [router]);
  return null;
}
