'use client';

import { useEffect, useState } from 'react';
import { logout } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

/**
 * Full-page block shown when a tenant-side API call is rejected because the whole
 * account is suspended or cancelled (HTTP 403 with error TENANT_SUSPENDED /
 * TENANT_CANCELLED). The central api client (see lib/api.ts) stashes the server
 * message in sessionStorage and redirects here, replacing the normal dashboard.
 *
 * This route lives outside the dashboard/admin shells on purpose: those shells
 * fire their own authenticated calls on mount, which would loop back here.
 */
interface Block { error?: string; message?: string }

export default function AccountSuspendedPage() {
  const { t } = useI18n();
  const [block, setBlock] = useState<Block>({});

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('aire_tenant_block');
      if (raw) setBlock(JSON.parse(raw) as Block);
    } catch { /* fall back to the generic copy below */ }
  }, []);

  const cancelled = block.error === 'TENANT_CANCELLED';
  const title = cancelled
    ? t('accountBlocked.cancelledTitle', 'Account cancelled')
    : t('accountBlocked.suspendedTitle', 'Account suspended');
  const message = block.message
    || (cancelled
      ? t('accountBlocked.cancelledMessage', 'This account has been cancelled and can no longer be accessed. Please contact support if you believe this is a mistake.')
      : t('accountBlocked.suspendedMessage', 'Access to this account is currently suspended. Please contact support to restore access.'));

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6" data-testid="account-suspended">
      <div className="card max-w-md w-full text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-2xl" aria-hidden>
          {cancelled ? '⛔' : '⏸️'}
        </div>
        <h1 className="text-xl font-bold text-text-primary">{title}</h1>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        <button onClick={logout} className="btn-primary mt-6 w-full" data-testid="account-suspended-signout">
          {t('common.signOut', 'Sign out')}
        </button>
      </div>
    </div>
  );
}
