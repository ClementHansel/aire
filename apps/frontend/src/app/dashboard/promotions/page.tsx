'use client';

// Promotions now live as a tab inside the Vouchers & Promotions page.
// This route is kept as a redirect so existing bookmarks/deep-links don't 404.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PromotionsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/vouchers?tab=promotions'); }, [router]);
  return null;
}
