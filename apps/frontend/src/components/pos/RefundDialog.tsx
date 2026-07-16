'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface RefundableLine {
  orderItemId: string;
  serviceName: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  remainingQty: number;
  remainingAmount: number;
}
interface Refundable {
  orderId: string;
  orderNumber: string;
  status: string;
  refundable: boolean;
  lines: RefundableLine[];
}

const METHODS = ['cash', 'bank', 'qris', 'edc', 'transfer'] as const;

/**
 * POS refund dialog — select lines (partial quantities/amounts), a reason and
 * method, then submit. Reveals an admin-PIN field when the backend requires one
 * (same gate as void). Records real money returned via POST /refunds.
 */
export function RefundDialog({ orderId, onDone, onCancel }: { orderId: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<Refundable | null>(null);
  const [sel, setSel] = useState<Record<string, { on: boolean; qty: number; amount: number }>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [adminPin, setAdminPin] = useState('');
  const [requiresPin, setRequiresPin] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Refundable>(`/refunds/refundable/${orderId}`)
      .then((d) => {
        setData(d);
        const init: Record<string, { on: boolean; qty: number; amount: number }> = {};
        for (const l of d.lines) init[l.orderItemId] = { on: false, qty: l.remainingQty, amount: l.remainingAmount };
        setSel(init);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load order'));
  }, [orderId]);

  const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
  const total = data ? data.lines.reduce((s, l) => { const e = sel[l.orderItemId]; return s + (e?.on ? e.amount : 0); }, 0) : 0;

  const submit = async () => {
    if (!data) return;
    const items = data.lines
      .filter((l) => sel[l.orderItemId]?.on)
      .map((l) => { const e = sel[l.orderItemId]!; return { orderItemId: l.orderItemId, quantity: e.qty, amount: e.amount }; });
    if (items.length === 0) { setErr(t('pos.refund.selectLine', 'Select at least one line to refund.')); return; }
    if (!reason.trim()) { setErr(t('pos.refund.reasonRequired', 'A refund reason is required.')); return; }
    setBusy(true); setErr('');
    try {
      await api.post('/refunds', { orderId, reason, refundMethod: method, items, adminPin: adminPin || undefined });
      onDone();
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { requiresPin?: boolean } | undefined) : undefined;
      if (details?.requiresPin) { setRequiresPin(true); setErr(e instanceof Error ? e.message : ''); }
      else setErr(e instanceof Error ? e.message : t('pos.refund.failed', 'Refund failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="section-title">{t('pos.refund.title', 'Issue refund')} {data ? `· ${data.orderNumber}` : ''}</h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text-primary" aria-label="Close">✕</button>
        </div>

        {err && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 mb-3">{err}</div>}

        {!data ? (
          <p className="text-sm text-text-muted">{t('common.loading', 'Loading…')}</p>
        ) : !data.refundable ? (
          <p className="text-sm text-text-muted">{t('pos.refund.notRefundable', 'This order is not in a refundable state.')}</p>
        ) : (
          <>
            <div className="space-y-2">
              {data.lines.map((l) => {
                const s = sel[l.orderItemId] ?? { on: false, qty: 0, amount: 0 };
                const maxed = l.remainingAmount <= 0;
                return (
                  <div key={l.orderItemId} className={`rounded-lg border p-3 ${s.on ? 'border-primary-400 bg-primary-50/40' : 'border-border'} ${maxed ? 'opacity-50' : ''}`}>
                    <label className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" disabled={maxed} checked={s.on}
                          onChange={(e) => setSel({ ...sel, [l.orderItemId]: { ...s, on: e.target.checked } })} />
                        <span className="text-sm">{l.serviceName ?? '—'}</span>
                      </span>
                      <span className="text-xs text-text-muted">{t('pos.refund.remaining', 'Refundable')}: {fmt(l.remainingAmount)}</span>
                    </label>
                    {s.on && (
                      <div className="mt-2 flex items-center gap-3 pl-6">
                        <label className="text-xs text-text-secondary">{t('pos.refund.qty', 'Qty')}
                          <input type="number" min={0} max={l.remainingQty} value={s.qty} className="input-field mt-1 w-20"
                            onChange={(e) => setSel({ ...sel, [l.orderItemId]: { ...s, qty: Number(e.target.value) } })} />
                        </label>
                        <label className="text-xs text-text-secondary">{t('pos.refund.amount', 'Amount (Rp)')}
                          <input type="number" min={0} max={l.remainingAmount} value={s.amount} className="input-field mt-1 w-28"
                            onChange={(e) => setSel({ ...sel, [l.orderItemId]: { ...s, amount: Number(e.target.value) } })} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm">{t('pos.refund.method', 'Method')}
                <select className="input-field mt-1" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
                </select>
              </label>
              <div className="flex flex-col justify-end">
                <span className="text-xs text-text-muted">{t('pos.refund.total', 'Total refund')}</span>
                <span className="text-lg font-bold text-rose-600">{fmt(total)}</span>
              </div>
            </div>

            <label className="mt-3 block text-sm">{t('pos.refund.reason', 'Reason')}
              <textarea className="input-field mt-1" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={t('pos.refund.reasonHint', 'Why is this being refunded?')} />
            </label>

            {requiresPin && (
              <label className="mt-3 block text-sm">{t('pos.refund.adminPin', 'Admin PIN')}
                <input type="password" className="input-field mt-1" value={adminPin} onChange={(e) => setAdminPin(e.target.value)} autoFocus />
              </label>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={onCancel} disabled={busy}>{t('common.cancel', 'Cancel')}</button>
              <button className="btn-primary" onClick={submit} disabled={busy || total <= 0}>
                {busy ? t('pos.refund.processing', 'Processing…') : t('pos.refund.confirm', 'Confirm refund')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
