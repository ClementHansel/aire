'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n, LanguageToggle } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface BookingDetail {
  customerName: string; plate: string | null; serviceName: string | null;
  scheduledAt: string; status: string; outletName: string | null;
}

/**
 * Public booking confirm page — opened by the branch cashier from the WhatsApp
 * link. Confirm adds the car to the queue and notifies the customer; reject
 * declines it. The unguessable token in the URL is the only credential.
 */
export default function ConfirmBookingPage() {
  const params = useParams();
  const token = params.token as string;
  const { t } = useI18n();
  const [b, setB] = useState<BookingDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'confirmed' | 'rejected' | null>(null);

  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

  const load = useCallback(() => {
    fetch(`${base}/public/bookings/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('notfound'))))
      .then((d: BookingDetail) => { setB(d); if (d.status === 'confirmed' || d.status === 'rejected') setResult(d.status); })
      .catch(() => setErr(t('confirmBooking.notFound', 'Booking not found or the link has expired.')));
  }, [base, token, t]);
  useEffect(() => { load(); }, [load]);

  const act = async (action: 'confirm' | 'reject') => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${base}/public/bookings/${token}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message || 'Failed'); }
      setResult(action === 'confirm' ? 'confirmed' : 'rejected');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-3"><LanguageToggle /></div>
        <div className="card space-y-4">
          <h1 className="text-lg font-bold text-text-primary">{t('confirmBooking.title', 'Confirm booking')}</h1>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
          {!b && !err && <p className="text-sm text-text-muted">{t('confirmBooking.loading', 'Loading…')}</p>}
          {b && (
            <>
              <div className="rounded-lg bg-surface-sunken p-3 text-sm space-y-1">
                <p className="font-semibold text-text-primary">{b.customerName}{b.plate ? ` · ${b.plate}` : ''}</p>
                {b.serviceName && <p className="text-text-secondary">{b.serviceName}</p>}
                <p className="text-text-secondary">{new Date(b.scheduledAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}</p>
                {b.outletName && <p className="text-text-muted text-xs">{b.outletName}</p>}
              </div>
              {result ? (
                <div className={`rounded-lg p-3 text-sm text-center font-medium ${result === 'confirmed' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                  {result === 'confirmed' ? t('confirmBooking.confirmed', '✓ Confirmed — the car has been added to the queue and the customer notified.') : t('confirmBooking.rejected', 'Booking rejected — the customer has been notified.')}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-secondary" onClick={() => act('reject')} disabled={busy}>{t('confirmBooking.reject', 'Reject')}</button>
                  <button className="btn-primary" onClick={() => act('confirm')} disabled={busy}>{busy ? t('confirmBooking.working', '…') : t('confirmBooking.confirm', 'Confirm')}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
