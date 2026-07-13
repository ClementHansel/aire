'use client';

// The receipt designer now lives as a tab inside the POS Terminals page.
// This route is kept as a redirect so existing bookmarks/deep-links don't 404.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ReceiptDesignerRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/pos-devices?tab=receipt'); }, [router]);
  return null;
}
