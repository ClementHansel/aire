'use client';

// The invoice designer now lives as a tab inside the Invoices page.
// This route is kept as a redirect so existing bookmarks/deep-links don't 404.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InvoiceDesignerRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/invoices?tab=designer'); }, [router]);
  return null;
}
