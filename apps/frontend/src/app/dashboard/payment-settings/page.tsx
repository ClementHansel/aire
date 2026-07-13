'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The Payment Gateway settings moved into the Settings page as a tab.
 * This route now redirects there so old links keep working.
 */
export default function PaymentSettingsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/settings?tab=payment'); }, [router]);
  return <div className="card text-sm text-text-muted">Redirecting to Settings → Payment Gateway…</div>;
}
