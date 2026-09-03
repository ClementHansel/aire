'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { usePublicBranding } from '@/lib/publicBranding';
import { useResolveTenant } from '@/lib/resolveTenant';
import { AirinLogo } from '@/components/shared/AirinLogo';

interface QueueStatus {
  orderNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  status: 'queued' | 'in_progress' | 'completed' | 'cancelled';
  assignedBay?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function KioskPage() {
  const { t } = useI18n();
  const { id: tenantId, slug, status } = useResolveTenant();
  usePublicBranding(tenantId ?? undefined);
  const [orderNumber, setOrderNumber] = useState('');
  const [result, setResult] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (!orderNumber.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
      const res = await fetch(`${base}/kiosk/queue-status?orderNumber=${encodeURIComponent(orderNumber.trim())}`);
      if (!res.ok) {
        setError(res.status === 404
          ? t('cust.kioskLanding.errorNotFound', 'Order not found. Please check your order number.')
          : t('cust.kioskLanding.errorUnable', 'Unable to check status. Please try again.'));
        return;
      }
      setResult(await res.json());
    } catch {
      setError(t('cust.kioskLanding.errorConnection', 'Connection error. Please try again.'));
    } finally { setLoading(false); }
  }, [orderNumber, t]);

  const statusLabel: Record<string, string> = {
    queued: t('cust.kioskLanding.statusQueued', 'In Queue'),
    in_progress: t('cust.kioskLanding.statusInProgress', 'In Progress'),
    completed: t('cust.kioskLanding.statusCompleted', 'Completed'),
    cancelled: t('cust.kioskLanding.statusCancelled', 'Cancelled'),
  };

  if (status === 'loading') {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">…</div>;
  }
  if (status === 'notfound') {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('cust.notFound', 'This page is not available.')}</div>;
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <AirinLogo size="xl" showWordmark={false} className="mb-4" />
          <h1 className="text-3xl font-bold text-text-primary">{t('cust.kioskLanding.title', 'Check Your Queue')}</h1>
          <p className="mt-2 text-text-secondary">{t('cust.kioskLanding.subtitle', 'Enter your order number to see your position and wait time')}</p>
        </div>

        <div className="card">
          <label className="block text-sm font-medium text-text-primary mb-1.5">{t('cust.kioskLanding.orderNumberLabel', 'Order Number')}</label>
          <div className="flex gap-2">
            <input
              className="input-field text-lg"
              placeholder={t('cust.kioskLanding.orderNumberPlaceholder', 'e.g. ORD-20260630-001')}
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && check()}
              autoFocus
            />
            <button className="btn-primary whitespace-nowrap" onClick={check} disabled={!orderNumber.trim() || loading}>
              {loading ? '…' : t('cust.kioskLanding.check', 'Check')}
            </button>
          </div>

          {error && <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          {result && (
            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-center text-sm text-text-secondary">{t('cust.kioskLanding.order', 'Order')}</p>
              <p className="text-center text-xl font-semibold text-text-primary mb-5">{result.orderNumber}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-primary-50 p-4 text-center">
                  <p className="text-xs text-primary-700 uppercase font-medium">{t('cust.kioskLanding.position', 'Position')}</p>
                  <p className="text-4xl font-bold text-primary-600 mt-1">#{result.position}</p>
                </div>
                <div className="rounded-xl bg-surface-sunken p-4 text-center">
                  <p className="text-xs text-text-secondary uppercase font-medium">{t('cust.kioskLanding.estWait', 'Est. Wait')}</p>
                  <p className="text-4xl font-bold text-text-primary mt-1">{result.estimatedWaitMinutes}<span className="text-lg"> {t('cust.kioskLanding.min', 'min')}</span></p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-center gap-3">
                <span className="badge bg-primary-50 text-primary-700">{statusLabel[result.status] ?? result.status}</span>
                {result.assignedBay && <span className="badge bg-green-50 text-green-700">{t('cust.kioskLanding.bay', 'Bay')}: {result.assignedBay}</span>}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-6">{t('cust.kioskLanding.tenant', 'Tenant')}: {slug ?? tenantId}</p>
      </div>
    </div>
  );
}
