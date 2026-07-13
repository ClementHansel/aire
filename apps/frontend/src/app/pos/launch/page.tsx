'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { setPosDevice, validatePosToken, getPosDeviceToken, getPosOutletId } from '@/lib/posDevice';
import { useI18n } from '@/lib/i18n';

/**
 * POS terminal launch. Opened once per device via the launch URL from
 * Dashboard → POS Terminals (`/pos/launch?posToken=…`). Validates + stores the
 * device token, then redirects into the POS pinned to the device's branch.
 */
export default function PosLaunchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">…</div>}>
      <PosLaunchInner />
    </Suspense>
  );
}

function PosLaunchInner() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('posToken') || getPosDeviceToken();
    if (!token) { setError(t('pos.launch.missing', 'Missing device token. Open the launch URL from Dashboard → POS Terminals.')); return; }
    let alive = true;
    validatePosToken(token)
      .then((ctx) => {
        if (!alive) return;
        setPosDevice(token, ctx);
        window.location.replace(`/pos/${ctx.outletId}/new-order`);
      })
      .catch((e) => {
        if (!alive) return;
        // Fall back to an already-registered device if the fresh token failed.
        const outletId = getPosOutletId();
        if (getPosDeviceToken() && outletId) { window.location.replace(`/pos/${outletId}/new-order`); return; }
        setError(e instanceof Error ? e.message : 'Invalid device token');
      });
    return () => { alive = false; };
  }, [params, t]);

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
      {error ? (
        <>
          <p className="text-lg font-semibold text-text-primary">{t('pos.launch.errTitle', "This terminal isn't registered")}</p>
          <p className="text-sm text-text-muted mt-2 max-w-sm">{error}</p>
        </>
      ) : (
        <p className="text-sm text-text-muted">{t('pos.launch.setting', 'Setting up this POS terminal…')}</p>
      )}
    </div>
  );
}
