'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { getPosOutletName } from '@/lib/posDevice';
import { PosNav } from '@/components/pos/PosNav';
import { VoidDialog } from '@/components/pos/VoidDialog';
import { RefundDialog } from '@/components/pos/RefundDialog';
import { useI18n } from '@/lib/i18n';
import { buildDocHtml, type DocTemplate, type DocData } from '@/components/dashboard/DocumentRenderer';

interface OrderCardItem { serviceName: string; quantity: number; subtotal: number }
interface OrderCard {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  licensePlate?: string;
  operatorName: string;
  status: 'ordered' | 'paid' | 'confirmed' | 'completed' | 'cancelled';
  items: OrderCardItem[];
  subtotal: number;
  serviceCharge: number;
  tax: number;
  voucherDiscount: number;
  promoDiscount: number;
  paymentMethod?: string | null;
  total: number;
  createdAt: string;
}
interface OrderListResponse { orders: OrderCard[]; total: number; page: number; pageSize: number; hasMore: boolean }

const STATUS_BADGE: Record<string, string> = {
  ordered: 'bg-amber-50 text-amber-700',
  paid: 'bg-green-50 text-green-700',
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-700',
};

const STATUSES = ['all', 'ordered', 'paid', 'confirmed', 'completed', 'cancelled'];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export default function OrdersPage() {
  const { t } = useI18n();
  const params = useParams();
  const agent = params.outletAgentId as string;
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Designed receipt layout (falls back to the built-in thermal HTML if absent).
  const [receiptTpl, setReceiptTpl] = useState<DocTemplate | null>(null);

  // Void flow state.
  const [voidTarget, setVoidTarget] = useState<OrderCard | null>(null);
  const [voidRequiresPin, setVoidRequiresPin] = useState(false);
  const [voidErr, setVoidErr] = useState('');
  const [pinRequestStatus, setPinRequestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  // Refund flow state.
  const [refundTarget, setRefundTarget] = useState<OrderCard | null>(null);

  // Settle (pay) flow state — for an unpaid ('ordered') order rung up but not yet paid.
  const [payTarget, setPayTarget] = useState<OrderCard | null>(null);
  const [payMethod, setPayMethod] = useState<'cash' | 'qris_static'>('cash');
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (status !== 'all') qs.set('status', status);
      if (search.trim()) qs.set('search', search.trim());
      const data = await api.get<OrderListResponse>(`/orders?${qs.toString()}`);
      setOrders(data.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.orders.loadFailed', 'Failed to load orders'));
    } finally { setLoading(false); }
  }, [status, search]);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
  }, [load]);

  useEffect(() => { api.get<DocTemplate>('/doc-template/receipt').then(setReceiptTpl).catch(() => setReceiptTpl(null)); }, []);

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const isPaid = (s: OrderCard['status']) => s === 'paid' || s === 'confirmed' || s === 'completed';

  const openVoid = (o: OrderCard) => { setVoidTarget(o); setVoidRequiresPin(false); setVoidErr(''); setPinRequestStatus('idle'); };

  // Generates + emails a one-time admin PIN to the tenant owner for this order.
  const requestVoidPin = async () => {
    if (!voidTarget) return;
    setPinRequestStatus('sending');
    try {
      await api.post(`/orders/${voidTarget.id}/void-pin`, {});
      setPinRequestStatus('sent');
    } catch {
      setPinRequestStatus('error');
    }
  };

  const confirmVoid = async (data: { reason: string; adminPin?: string }) => {
    if (!voidTarget) return;
    setVoidErr('');
    try {
      const res = await api.post<{ showPaidWarning: boolean; paidWarningMessage?: string }>(
        `/orders/${voidTarget.id}/void`, { reason: data.reason, adminPin: data.adminPin },
      );
      setVoidTarget(null); setVoidRequiresPin(false);
      if (res.showPaidWarning && res.paidWarningMessage) window.alert(res.paidWarningMessage);
      load();
    } catch (e) {
      // Backend asks for an admin PIN when the free-void window has passed.
      const details = e instanceof ApiError ? (e.details as { requiresPin?: boolean } | undefined) : undefined;
      if (details?.requiresPin) { setVoidRequiresPin(true); setVoidErr(e instanceof Error ? e.message : ''); return; }
      setVoidErr(e instanceof Error ? e.message : t('pos.orders.voidFailed', 'Void failed'));
    }
  };

  // Settle an unpaid ('ordered') order via the existing pay endpoint — reuses the
  // same /orders/:id/pay call the new-order payment modal uses.
  const openSettle = (o: OrderCard, method: 'cash' | 'qris_static') => {
    setPayTarget(o); setPayMethod(method); setPayAmount(String(o.total)); setPayErr('');
  };

  const confirmSettle = async () => {
    if (!payTarget) return;
    setPaying(true); setPayErr('');
    try {
      await api.post(`/orders/${payTarget.id}/pay`, {
        method: payMethod,
        amountReceived: payMethod === 'cash' ? Number(payAmount) : undefined,
      });
      setPayTarget(null);
      load();
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : t('pos.orders.paymentFailed', 'Payment failed'));
    } finally {
      setPaying(false);
    }
  };

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    cash: t('pos.orders.pmCash', 'Cash'),
    qris_static: t('pos.orders.pmQrisStatic', 'QRIS (static)'),
    qris_dynamic: t('pos.orders.pmQrisDynamic', 'QRIS'),
    edc: t('pos.orders.pmEdc', 'EDC / Debit'),
    cc: t('pos.orders.pmCc', 'Credit Card'),
    transfer: t('pos.orders.pmTransfer', 'Bank Transfer'),
  };

  // Client-side printable receipt (opens a print window). Reusable for reprint.
  const printReceipt = (o: OrderCard) => {
    const branch = getPosOutletName() ?? '';
    const paymentLabel = o.paymentMethod ? (PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod) : '';

    // Designed layout: fill the tenant's receipt template with this order.
    if (receiptTpl) {
      const totals: DocData['totals'] = [
        { label: t('pos.orders.subtotal', 'Subtotal'), value: fmt(o.subtotal) },
      ];
      if (o.serviceCharge > 0) totals.push({ label: t('pos.orders.serviceCharge', 'Service charge'), value: fmt(o.serviceCharge) });
      if (o.tax > 0) totals.push({ label: t('pos.orders.tax', 'Tax/PPN'), value: fmt(o.tax) });
      if (o.voucherDiscount > 0) totals.push({ label: t('pos.orders.voucher', 'Voucher'), value: `−${fmt(o.voucherDiscount)}` });
      if (o.promoDiscount > 0) totals.push({ label: t('pos.orders.promo', 'Promo'), value: `−${fmt(o.promoDiscount)}` });
      totals.push({ label: t('pos.orders.total', 'Total'), value: fmt(o.total), strong: true });
      const data: DocData = {
        fields: {
          outlet_name: branch, outlet_address: '', outlet_phone: '',
          order_number: o.orderNumber, datetime: new Date(o.createdAt).toLocaleString('id-ID'),
          customer_name: o.customerName, license_plate: o.licensePlate ?? '',
          operator_name: o.operatorName ?? '', payment_method: paymentLabel,
        },
        items: o.items.map((it) => ({ line: `${it.quantity}× ${it.serviceName}`, subtotal: fmt(it.subtotal) })),
        totals,
        logo: null, code: null,
      };
      const w = window.open('', '_blank', 'width=340,height=600');
      if (!w) { window.alert(t('pos.orders.popupBlocked', 'Allow pop-ups to print the receipt.')); return; }
      w.document.write(buildDocHtml(receiptTpl, data, o.orderNumber));
      w.document.close();
      return;
    }


    const rows = o.items.map((it) => `<tr><td>${it.quantity}× ${escapeHtml(it.serviceName)}</td><td style="text-align:right">${fmt(it.subtotal)}</td></tr>`).join('');
    const breakdownRows = [
      `<tr><td>${t('pos.orders.subtotal', 'Subtotal')}</td><td style="text-align:right">${fmt(o.subtotal)}</td></tr>`,
      o.serviceCharge > 0 ? `<tr><td>${t('pos.orders.serviceCharge', 'Service charge')}</td><td style="text-align:right">${fmt(o.serviceCharge)}</td></tr>` : '',
      o.tax > 0 ? `<tr><td>${t('pos.orders.tax', 'Tax/PPN')}</td><td style="text-align:right">${fmt(o.tax)}</td></tr>` : '',
      o.voucherDiscount > 0 ? `<tr><td>${t('pos.orders.voucher', 'Voucher')}</td><td style="text-align:right">−${fmt(o.voucherDiscount)}</td></tr>` : '',
      o.promoDiscount > 0 ? `<tr><td>${t('pos.orders.promo', 'Promo')}</td><td style="text-align:right">−${fmt(o.promoDiscount)}</td></tr>` : '',
    ].filter(Boolean).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${o.orderNumber}</title>
      <style>*{font-family:ui-monospace,Menlo,Consolas,monospace}body{width:280px;margin:0 auto;padding:12px;color:#111}
      h1{font-size:15px;text-align:center;margin:0 0 2px}.muted{color:#555;font-size:11px;text-align:center;margin:0}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}td{padding:2px 0}
      .brk{border-top:1px dashed #999;margin-top:4px}
      .tot{border-top:1px dashed #999;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-weight:700}
      .foot{text-align:center;font-size:11px;color:#555;margin-top:10px}</style></head>
      <body onload="window.print()">
      <h1>${escapeHtml(branch || 'Receipt')}</h1>
      <p class="muted">${o.orderNumber} · ${new Date(o.createdAt).toLocaleString('id-ID')}</p>
      <p class="muted">${escapeHtml(o.customerName)}${o.customerPhone ? ' · ' + escapeHtml(o.customerPhone) : ''}${o.licensePlate ? ' · ' + escapeHtml(o.licensePlate) : ''}</p>
      <table>${rows}</table>
      <table class="brk">${breakdownRows}</table>
      <div class="tot"><span>Total</span><span>${fmt(o.total)}</span></div>
      <p class="foot">${o.status.toUpperCase()}${paymentLabel ? ' · ' + escapeHtml(paymentLabel) : ''} · ${escapeHtml(o.operatorName || '')}</p>
      <p class="foot">Terima kasih!</p>
      </body></html>`;
    const w = window.open('', '_blank', 'width=340,height=600');
    if (!w) { window.alert(t('pos.orders.popupBlocked', 'Allow pop-ups to print the receipt.')); return; }
    w.document.write(html); w.document.close();
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PosNav agent={agent} active="orders" title={t('pos.orders.title', 'Orders')} />

      <div className="p-5 flex-1">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input className="input-field max-w-xs" placeholder={t('pos.orders.searchPlaceholder', 'Search order # / name / phone…')} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <select aria-label={t('pos.orders.filterByStatus', 'Filter by status')} className="input-field max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s === 'all' ? t('pos.orders.allStatuses', 'All statuses') : s}</option>)}
          </select>
          <button className="btn-secondary" onClick={load}>{t('pos.orders.refresh', 'Refresh')}</button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

        {loading ? (
          <div className="card text-sm text-text-muted">{t('pos.orders.loading', 'Loading orders…')}</div>
        ) : orders.length === 0 ? (
          <div className="card text-sm text-text-muted">{t('pos.orders.noOrders', 'No orders found.')}</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {orders.map((o) => (
              <div key={o.id} className="card" data-testid={`order-card-${o.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-text-primary">{o.orderNumber}</span>
                  <span className={`badge ${STATUS_BADGE[o.status]} capitalize`}>{o.status}</span>
                </div>
                <p className="text-sm text-text-primary">{o.customerName}</p>
                <p className="text-xs text-text-muted">{o.customerPhone}{o.licensePlate ? ` · ${o.licensePlate}` : ''}</p>
                <ul className="mt-3 space-y-1 border-t border-border pt-2">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex justify-between text-xs text-text-secondary">
                      <span>{it.quantity}× {it.serviceName}</span>
                      <span>{fmt(it.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                {/* Order highlights — how it was paid and who rang it up. Both
                    already come back from /orders; the card just never showed
                    them, so cashiers had to open the receipt to tell two
                    same-total orders apart (AIRIN-115). */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {o.paymentMethod ? (
                    <span className="badge bg-sky-50 text-sky-700 text-xs" data-testid={`order-payment-${o.id}`}>
                      {PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod}
                    </span>
                  ) : (
                    <span className="badge bg-amber-50 text-amber-700 text-xs">{t('pos.orders.unpaid', 'Unpaid')}</span>
                  )}
                  {o.operatorName && (
                    <span className="badge bg-surface-sunken text-text-secondary text-xs" data-testid={`order-cashier-${o.id}`}>
                      {t('pos.orders.cashierLabel', 'Cashier')}: {o.operatorName}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center mt-3 pt-2 border-t border-border">
                  <span className="text-xs text-text-muted">{new Date(o.createdAt).toLocaleString('id-ID')}</span>
                  <span className="font-semibold text-primary-600">{fmt(o.total)}</span>
                </div>
                {o.status === 'ordered' && (
                  <div className="flex gap-2 mt-3">
                    <button className="btn-primary text-xs flex-1" onClick={() => openSettle(o, 'cash')}>
                      💵 {t('pos.orders.settleCash', 'Cash')}
                    </button>
                    <button className="btn-primary text-xs flex-1" onClick={() => openSettle(o, 'qris_static')}>
                      📱 {t('pos.orders.settleQris', 'QRIS')}
                    </button>
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <button className="btn-secondary text-xs flex-1" onClick={() => printReceipt(o)}>
                    🖨 {t('pos.orders.receipt', 'Receipt')}
                  </button>
                  {o.status !== 'cancelled' && (
                    <button className="btn-ghost text-xs flex-1 text-red-600 hover:bg-red-50" onClick={() => openVoid(o)}>
                      {isPaid(o.status) ? t('pos.orders.void', 'Void') : t('pos.orders.cancel', 'Cancel')}
                    </button>
                  )}
                </div>
                {isPaid(o.status) && (
                  <button className="btn-ghost text-xs w-full mt-2 text-amber-700 hover:bg-amber-50" onClick={() => setRefundTarget(o)}>
                    ↩ {t('pos.orders.refund', 'Refund')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md">
            {voidErr && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 mb-2">{voidErr}</div>}
            <VoidDialog
              requiresPin={voidRequiresPin}
              isPaidOrder={isPaid(voidTarget.status)}
              onConfirm={confirmVoid}
              onCancel={() => { setVoidTarget(null); setVoidRequiresPin(false); setVoidErr(''); setPinRequestStatus('idle'); }}
              onRequestPin={requestVoidPin}
              pinRequestStatus={pinRequestStatus}
              subject={`${voidTarget.orderNumber} · ${fmt(voidTarget.total)}`}
              labels={{
                // Cancelling an unpaid order and voiding a paid one are different
                // acts with different consequences; the dialog says which one
                // this is instead of always saying "Void" (AIRIN-146).
                title: isPaid(voidTarget.status)
                  ? t('pos.orders.voidTitle', 'Void this paid order?')
                  : t('pos.orders.cancelTitle', 'Cancel this order?'),
                intro: isPaid(voidTarget.status)
                  ? t('pos.orders.voidIntro', 'The sale is reversed and any membership usage it consumed is returned. The order stays on record as voided.')
                  : t('pos.orders.cancelIntro', 'No payment was taken. The order stays on record as cancelled and cannot be reopened — ring up a new one instead.'),
                reasonLabel: t('pos.orders.voidReason', 'Reason'),
                reasonPlaceholder: isPaid(voidTarget.status)
                  ? t('pos.orders.voidReasonPlaceholder', 'Why is this paid order being voided?')
                  : t('pos.orders.cancelReasonPlaceholder', 'Why is this order being cancelled?'),
                confirm: isPaid(voidTarget.status)
                  ? t('pos.orders.voidConfirm', 'Void order')
                  : t('pos.orders.cancelConfirm', 'Cancel order'),
                dismiss: t('pos.orders.voidDismiss', 'Keep order'),
                reasonRequired: t('pos.orders.voidReasonRequired', 'Enter a reason first.'),
                pinRequired: t('pos.orders.voidPinRequired', 'Admin PIN is required.'),
                pinInvalid: t('pos.orders.voidPinInvalid', 'The PIN must be exactly 6 digits.'),
                requestPin: t('pos.orders.requestPin', 'Request Admin PIN'),
                requestPinSending: t('pos.orders.requestPinSending', 'Sending…'),
                requestPinSent: t('pos.orders.requestPinSent', 'PIN sent to owner’s email.'),
                requestPinFailed: t('pos.orders.requestPinFailed', 'Failed to send PIN'),
                pinLabel: t('pos.orders.pinLabel', 'Admin PIN'),
                pinPlaceholder: t('pos.orders.pinPlaceholder', 'Enter the 6-digit PIN from the email'),
              }}
            />
          </div>
        </div>
      )}

      {refundTarget && (
        <RefundDialog
          orderId={refundTarget.id}
          onDone={() => { setRefundTarget(null); load(); }}
          onCancel={() => setRefundTarget(null)}
        />
      )}

      {/* Settle payment — Cash/QRIS for an unpaid ('ordered') order. */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !paying && setPayTarget(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title">{t('pos.orders.settlePayment', 'Settle Payment')} — {payTarget.orderNumber}</h3>
            {payErr && <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-700">{payErr}</div>}
            <div className="mt-3 flex justify-between text-sm">
              <span className="text-text-secondary">{t('pos.orders.total', 'Total')}</span>
              <span className="font-semibold text-primary-600">{fmt(payTarget.total)}</span>
            </div>
            <div className="mt-3 inline-flex rounded-md border border-border bg-surface-raised p-0.5" role="group" aria-label={t('pos.orders.paymentMethod', 'Payment method')}>
              <button type="button" onClick={() => setPayMethod('cash')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${payMethod === 'cash' ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                💵 {t('pos.orders.settleCash', 'Cash')}
              </button>
              <button type="button" onClick={() => setPayMethod('qris_static')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${payMethod === 'qris_static' ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                📱 {t('pos.orders.settleQris', 'QRIS')}
              </button>
            </div>
            {payMethod === 'cash' ? (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1.5">{t('pos.new.amountReceived', 'Amount Received')}</label>
                <input aria-label={t('pos.new.amountReceived', 'Amount received')} type="number" className="input-field" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                <p className="mt-1 text-sm text-text-secondary">{t('pos.new.change', 'Change:')} <span className="font-medium text-text-primary">{fmt(Math.max(0, Number(payAmount || 0) - payTarget.total))}</span></p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-text-secondary">{t('pos.orders.qrisStaticNote', "Confirm once the customer has scanned the outlet's QRIS sticker and paid.")}</p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-secondary" onClick={() => setPayTarget(null)} disabled={paying}>{t('pos.new.cancel', 'Cancel')}</button>
              <button className="btn-primary" onClick={confirmSettle} disabled={paying}>
                {paying ? t('pos.new.processing', 'Processing…') : payMethod === 'qris_static' ? t('pos.new.markPaid', 'Tandai Sudah Bayar') : t('pos.new.confirmPayment', 'Confirm Payment')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
