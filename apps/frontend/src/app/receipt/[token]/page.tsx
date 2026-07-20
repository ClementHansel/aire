'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n, LanguageToggle } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface ReceiptItem {
  serviceName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface ReceiptDetail {
  orderNumber: string;
  createdAt: string;
  branchName: string | null;
  tenantName: string;
  customerName: string;
  paymentMethod: string | null;
  subtotal: number;
  total: number;
  items: ReceiptItem[];
}

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Public order receipt/invoice — opened from the WhatsApp payment thank-you
 * link. The unguessable token in the URL is the only credential; no login,
 * no dashboard layout.
 */
export default function ReceiptPage() {
  const params = useParams();
  const token = params.token as string;
  const { t } = useI18n();
  const [r, setR] = useState<ReceiptDetail | null>(null);
  const [err, setErr] = useState('');

  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

  useEffect(() => {
    fetch(`${base}/public/receipt/${token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('notfound'))))
      .then((d: ReceiptDetail) => setR(d))
      .catch(() => setErr(t('receipt.notFound', 'Receipt not found or the link is invalid.')));
  }, [base, token, t]);

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-3"><LanguageToggle /></div>
        <div className="card space-y-4">
          <h1 className="text-lg font-bold text-text-primary">{t('receipt.title', 'Receipt')}</h1>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{err}</div>}
          {!r && !err && <p className="text-sm text-text-muted">{t('receipt.loading', 'Loading…')}</p>}
          {r && (
            <>
              <div className="rounded-lg bg-surface-sunken p-3 text-sm space-y-1">
                <p className="font-semibold text-text-primary">{r.tenantName}</p>
                {r.branchName && <p className="text-text-muted text-xs">{r.branchName}</p>}
                <p className="text-text-secondary">{r.orderNumber}</p>
                <p className="text-text-muted text-xs">{new Date(r.createdAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}</p>
              </div>

              <div className="divide-y divide-border">
                {r.items.map((it, i) => (
                  <div key={i} className="flex justify-between py-2 text-sm">
                    <div>
                      <p className="text-text-primary">{it.serviceName}</p>
                      <p className="text-text-muted text-xs">{it.quantity} × {fmtRp(it.unitPrice)}</p>
                    </div>
                    <p className="text-text-primary font-medium">{fmtRp(it.subtotal)}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg bg-surface-sunken p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-text-secondary">{t('receipt.subtotal', 'Subtotal')}</span><span className="text-text-primary">{fmtRp(r.subtotal)}</span></div>
                <div className="flex justify-between font-semibold"><span className="text-text-primary">{t('receipt.total', 'Total')}</span><span className="text-text-primary">{fmtRp(r.total)}</span></div>
                {r.paymentMethod && <div className="flex justify-between text-xs"><span className="text-text-muted">{t('receipt.paymentMethod', 'Payment')}</span><span className="text-text-muted">{r.paymentMethod}</span></div>}
              </div>

              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-center text-emerald-800 font-medium">
                {t('receipt.thanks', 'Thank you for your visit! 🙏')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
