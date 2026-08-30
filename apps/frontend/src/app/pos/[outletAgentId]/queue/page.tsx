'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { getPosOutletId } from '@/lib/posDevice';
import { PosNav } from '@/components/pos/PosNav';
import { PlateInput } from '@/components/shared/PlateInput';
import { useI18n } from '@/lib/i18n';
import { useBusinessUnits } from '@/lib/useBusinessUnits';

interface QueueEntry {
  id: string; plate: string | null; brand: string | null; model: string | null;
  customerName: string | null; customerPhone: string | null;
  businessUnit: string | null; note: string | null; status: string; position: number; createdAt: string;
  orderId: string | null; paymentStatus: 'paid' | 'unpaid';
  /** The one stage the board shows — see the backend's QueueEntry.stage. */
  stage?: 'waiting_payment' | 'paid' | 'done' | 'cancelled';
  startedAt?: string | null;
  /** Arrival → payment, in seconds; still recorded though no longer tapped in. */
  serviceSeconds?: number | null;
}

export default function QueuePage() {
  const { t } = useI18n();
  const params = useParams();
  const agent = params.outletAgentId as string;
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [businessUnit, setBusinessUnit] = useState<string>('AIRE');
  const { units: businessUnits } = useBusinessUnits();
  // Same reasoning as the POS catalog tabs — see AIRIN-176 there.
  useEffect(() => {
    if (businessUnits.length === 0) return;
    if (businessUnits.some((u) => u.code === businessUnit)) return;
    setBusinessUnit(businessUnits[0]!.code);
  }, [businessUnits, businessUnit]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // The queue is per-branch, so we need an operating outlet (like New Order).
  const [operatingOutletId, setOperatingOutletId] = useState<string | null>(null);
  const [scheduledOutletId, setScheduledOutletId] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  // Order id being collected for a queue entry that already has an order
  // (e.g. a kiosk pay-at-cashier order) — we settle it, never re-create.
  const [collectFor, setCollectFor] = useState<string | null>(null);
  const [vehicleBrands, setVehicleBrands] = useState<{ id: string; name: string; types: { id: string; name: string }[] }[]>([]);

  const load = useCallback(async (oid: string) => {
    try { setEntries(await api.get<QueueEntry[]>(`/vehicle-queue?outletId=${oid}`)); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : t('pos.queue.failedLoadQueue', 'Failed to load queue')); }
    finally { setLoading(false); }
  }, []);

  // Resolve the operating branch (today's scheduled branch, else home outlet).
  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    const u = getUser();
    // On a registered terminal the device pin fixes the operating branch.
    const pinned = getPosOutletId();
    api.get<{ todayOutletId: string | null; branches: { id: string; name: string }[] }>('/hr/my/branch-context')
      .then((ctx) => {
        setBranches(ctx?.branches ?? []);
        setScheduledOutletId(ctx?.todayOutletId ?? null);
        setOperatingOutletId(pinned ?? ctx?.todayOutletId ?? u?.outletId ?? null);
      })
      .catch(() => setOperatingOutletId(pinned ?? u?.outletId ?? null));
  }, []);

  // Load + poll the queue for the selected branch.
  useEffect(() => {
    if (!operatingOutletId) { setLoading(false); return; }
    load(operatingOutletId);
    const id = setInterval(() => load(operatingOutletId), 8000);
    return () => clearInterval(id);
  }, [operatingOutletId, load]);

  useEffect(() => {
    api.get<{ id: string; name: string; types: { id: string; name: string }[] }[]>('/vehicle-brands').then(setVehicleBrands).catch(() => {});
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatingOutletId) { setError(t('pos.queue.selectBranchFirst', 'Select an operating branch first.')); return; }
    if (!plate.trim()) { setError(t('pos.queue.enterPlate', 'Enter at least a plate number')); return; }
    setError('');
    try {
      await api.post('/vehicle-queue', { plate: plate.trim().toUpperCase(), brand: brand.trim() || undefined, model: model.trim() || undefined, businessUnit, outletId: operatingOutletId });
      setPlate(''); setBrand(''); setModel('');
      await load(operatingOutletId);
    } catch (err) { setError(err instanceof Error ? err.message : t('pos.queue.failedAdd', 'Failed to add')); }
  };

  const setStatus = async (id: string, status: string, reason?: string) => {
    try { await api.patch(`/vehicle-queue/${id}/status`, { status, reason }); if (operatingOutletId) await load(operatingOutletId); }
    catch (err) { setError(err instanceof Error ? err.message : t('pos.queue.failed', 'Failed')); }
  };

  /**
   * Taking a car OFF the board unserved is the one queue action that needs an
   * account of itself — the row is kept, so tomorrow's shift can see why the
   * car left without paying (AIRIN-171).
   */
  const cancelEntry = (q: QueueEntry) => {
    const reason = window.prompt(
      t('pos.queue.cancelReasonPrompt', 'Why is this car leaving the queue unserved?'),
      '',
    );
    // A dismissed prompt means "changed my mind", not "cancel with no reason".
    if (reason === null) return;
    if (!reason.trim()) { setError(t('pos.queue.cancelReasonRequired', 'Enter a reason to remove a car from the queue.')); return; }
    void setStatus(q.id, 'cancelled', reason.trim());
  };

  /** Arrival → now (or → payment, once paid), for the on-board timer. */
  const elapsedLabel = (q: QueueEntry) => {
    const startIso = q.startedAt ?? q.createdAt;
    const secs = q.serviceSeconds ?? Math.max(0, Math.round((Date.now() - new Date(startIso).getTime()) / 1000));
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}j ${mins % 60}m`;
  };

  /** The board's three words — see AIRIN-170. */
  const stageOf = (q: QueueEntry): 'waiting_payment' | 'paid' | 'done' | 'cancelled' =>
    q.stage ?? (q.status === 'done' ? 'done' : q.status === 'cancelled' ? 'cancelled' : q.paymentStatus === 'paid' ? 'paid' : 'waiting_payment');

  const STAGE_LABEL: Record<string, string> = {
    waiting_payment: t('pos.queue.stageWaitingPayment', 'Waiting for payment'),
    paid: t('pos.queue.stagePaid', 'Paid'),
    done: t('pos.queue.stageDone', 'Done'),
    cancelled: t('pos.queue.stageCancelled', 'Cancelled'),
  };

  const STAGE_STYLE: Record<string, string> = {
    waiting_payment: 'bg-rose-50 text-rose-700',
    paid: 'bg-green-50 text-green-700',
    done: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-gray-100 text-gray-500',
  };

  // "Proses Bayar" — carry the queued car into New Order so its details prefill
  // and (if a member) name/phone auto-resolve there. The cashier just pays.
  const payHref = (q: QueueEntry) => {
    const p = new URLSearchParams({ queueId: q.id });
    if (q.plate) p.set('plate', q.plate);
    if (q.brand) p.set('brand', q.brand);
    if (q.model) p.set('model', q.model);
    if (q.customerName) p.set('name', q.customerName);
    if (q.customerPhone) p.set('phone', q.customerPhone);
    if (q.businessUnit) p.set('bu', q.businessUnit);
    return `/pos/${agent}/new-order?${p.toString()}`;
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PosNav agent={agent} active="queue" title={t('pos.queue.title', 'Queue')} />

      {error && <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Operating branch — the queue is per-branch. Hidden on a registered
          terminal, where the branch is fixed by the device pin. */}
      {!getPosOutletId() && branches.length > 0 && (
        <div className="mx-5 mt-4 flex items-center gap-3 flex-wrap">
          <label htmlFor="queue-branch" className="text-sm text-text-muted">{t('pos.queue.operatingBranch', 'Operating branch')}</label>
          <select
            id="queue-branch"
            aria-label={t('pos.queue.operatingBranch', 'Operating branch')}
            className="input-field py-1 max-w-[240px]"
            value={operatingOutletId ?? ''}
            onChange={(e) => setOperatingOutletId(e.target.value)}
          >
            {operatingOutletId == null && <option value="">{t('pos.queue.selectBranch', 'Select branch…')}</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.id === scheduledOutletId ? ` — ${t('pos.queue.scheduled', 'scheduled')}` : ''}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 grid lg:grid-cols-3 gap-5 p-5">
        {/* Add arrival */}
        <div className="card h-fit">
          <h2 className="section-title mb-3">{t('pos.queue.logArrival', 'Log Arrival')}</h2>
          <form onSubmit={add} className="space-y-3">
            <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5 w-full">
              {businessUnits.map((bu) => (
                <button key={bu.code} type="button" onClick={() => setBusinessUnit(bu.code)} className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-md ${businessUnit === bu.code ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>{bu.name}</button>
              ))}
            </div>
            {/* PlateInput normalises the value itself; the old `uppercase` class
                only restyled the text while leaving spaces in the stored value. */}
            <PlateInput placeholder={t('pos.queue.platePlaceholder', 'Plate (e.g. D1234ABC) *')} value={plate} onChange={setPlate} />
            <input className="input-field" placeholder={t('pos.queue.brandPlaceholder', 'Brand (e.g. Honda)')} list="q-veh-brands" value={brand} onChange={(e) => setBrand(e.target.value)} />
            <datalist id="q-veh-brands">{vehicleBrands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
            <input className="input-field" placeholder={t('pos.queue.typePlaceholder', 'Type (e.g. Brio)')} list="q-veh-types" value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="q-veh-types">{(vehicleBrands.find((b) => b.name === brand)?.types ?? []).map((vt) => <option key={vt.id} value={vt.name} />)}</datalist>
            <button type="submit" className="btn-primary w-full">+ {t('pos.queue.addToQueue', 'Add to queue')}</button>
          </form>
          <p className="text-xs text-text-muted mt-2">{t('pos.queue.recordNote', 'Record cars as they arrive — service starts the moment a car is added. Complete the product & payment later from New Order.')}</p>
          <p className="text-xs text-text-muted mt-1">{t('pos.queue.dailyResetNote', 'The queue clears itself at midnight; anything still open is kept on record with a reason.')}</p>
        </div>

        {/* Queue list */}
        <div className="lg:col-span-2">
          <h2 className="section-title mb-3">{t('pos.queue.inQueue', 'In Queue')} ({entries.length})</h2>
          {loading ? <div className="card text-sm text-text-muted">{t('pos.queue.loading', 'Loading…')}</div> : entries.length === 0 ? (
            <div className="card text-sm text-text-muted">{t('pos.queue.empty', 'Queue is empty.')}</div>
          ) : (
            <div className="space-y-2">
              {entries.map((q) => (
                <div key={q.id} className={`card flex items-center gap-4 ${q.status === 'serving' ? 'border-primary-300 ring-1 ring-primary-100' : ''}`}>
                  <div className="w-9 h-9 rounded-full bg-surface-sunken flex items-center justify-center text-sm font-bold text-text-secondary shrink-0">{q.position}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-primary">{q.plate ?? '—'} <span className="badge ml-1 bg-sky-50 text-sky-700">{q.businessUnit ?? ''}</span></p>
                    <p className="text-xs text-text-muted">{[q.brand, q.model].filter(Boolean).join(' ') || t('pos.queue.vehicleDetailsNotSet', 'Vehicle details not set')} · {new Date(q.createdAt).toLocaleTimeString()}</p>
                  </div>
                  {/* ONE badge, not two. 'waiting' vs 'serving' was an internal
                      distinction the cashier had to maintain by hand and never
                      acted on; what matters is whether the car still owes money
                      (AIRIN-170). The timer beside it is the arrival→payment
                      duration, which is still recorded. */}
                  <div className="flex flex-col items-end gap-1">
                    <span className={`badge ${STAGE_STYLE[stageOf(q)]}`} data-testid={`queue-stage-${q.id}`}>{STAGE_LABEL[stageOf(q)]}</span>
                    <span className="text-[11px] text-text-muted">{elapsedLabel(q)}</span>
                  </div>
                  <div className="flex gap-1">
                    {q.paymentStatus === 'unpaid'
                      ? (q.orderId
                          ? <button className="btn-ghost text-xs text-primary-600 font-semibold" onClick={() => setCollectFor(q.orderId!)}>{t('pos.queue.prosesBayar', 'Proses Bayar')}</button>
                          : <Link href={payHref(q)} className="btn-ghost text-xs text-primary-600 font-semibold">{t('pos.queue.prosesBayar', 'Proses Bayar')}</Link>)
                      : <span className="badge bg-green-50 text-green-700">{t('pos.queue.paid', 'Paid')}</span>}
                    <button
                      className="btn-ghost text-xs text-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={q.paymentStatus !== 'paid'}
                      title={q.paymentStatus !== 'paid' ? t('pos.queue.collectBeforeDone', 'Collect payment before marking done') : t('pos.queue.markDone', 'Mark done')}
                      onClick={() => setStatus(q.id, 'done')}
                    >{t('pos.queue.done', 'Done')}</button>
                    <button
                      className="btn-ghost text-xs text-red-600"
                      title={t('pos.queue.removeUnserved', 'Remove from queue (asks for a reason)')}
                      onClick={() => cancelEntry(q)}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {collectFor && (
        <CollectPaymentModal
          orderId={collectFor}
          onClose={() => setCollectFor(null)}
          onPaid={() => { setCollectFor(null); if (operatingOutletId) load(operatingOutletId); }}
        />
      )}
    </div>
  );
}

/** Collect payment for an existing (already-created) order — e.g. a kiosk
 *  pay-at-cashier order picked from the queue. Settles the order in place. */
function CollectPaymentModal({ orderId, onClose, onPaid }: { orderId: string; onClose: () => void; onPaid: () => void }) {
  const { t } = useI18n();
  const [order, setOrder] = useState<{ orderNumber: string; total: number } | null>(null);
  const [method, setMethod] = useState<'cash' | 'qris_dynamic' | 'edc' | 'transfer'>('cash');
  const [amount, setAmount] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ orderNumber: string; status: string; total: number }>(`/orders/${orderId}`)
      .then((o) => {
        if (o.status !== 'ordered') { setErr(`${t('pos.queue.orderAlready', 'This order is already')} ${o.status}.`); return; }
        setOrder({ orderNumber: o.orderNumber, total: o.total });
        setAmount(String(o.total));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t('pos.queue.failedLoadOrder', 'Failed to load order')));
  }, [orderId]);

  useEffect(() => {
    if (!polling) return;
    const t = setInterval(async () => {
      try { const o = await api.get<{ status: string }>(`/orders/${orderId}`); if (o.status === 'paid') { clearInterval(t); onPaid(); } }
      catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(t);
  }, [polling, orderId, onPaid]);

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const confirm = async () => {
    if (!order) return;
    setBusy(true); setErr('');
    try {
      if (method === 'qris_dynamic') {
        const c = await api.post<{ qrString: string }>(`/payments/charge/${orderId}`);
        setQr(c.qrString); setPolling(true); return;
      }
      await api.post(`/orders/${orderId}/pay`, { method, amountReceived: method === 'cash' ? Number(amount) : undefined });
      onPaid();
    } catch (e) { setErr(e instanceof Error ? e.message : t('pos.queue.paymentFailed', 'Payment failed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title">{t('pos.queue.collectPayment', 'Collect payment')}{order ? ` — ${order.orderNumber}` : ''}</h3>
        {err && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{err}</div>}
        {order && (
          <>
            <div className="mt-4 flex justify-between text-base font-semibold border-b border-border pb-2"><span>{t('pos.queue.total', 'Total')}</span><span className="text-primary-600">{fmt(order.total)}</span></div>
            {!qr && (
              <>
                <label className="block text-sm font-medium mt-4 mb-1.5">{t('pos.queue.paymentMethod', 'Payment method')}</label>
                <select aria-label={t('pos.queue.paymentMethod', 'Payment method')} className="input-field" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  <option value="cash">{t('pos.queue.cash', 'Cash')}</option>
                  <option value="qris_dynamic">{t('pos.queue.qrisScan', 'QRIS (scan to pay)')}</option>
                  <option value="edc">{t('pos.queue.edcDebit', 'EDC / Debit')}</option>
                  <option value="transfer">{t('pos.queue.bankTransfer', 'Bank Transfer')}</option>
                </select>
                {method === 'cash' && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium mb-1.5">{t('pos.queue.amountReceived', 'Amount received')}</label>
                    <input aria-label={t('pos.queue.amountReceived', 'Amount received')} type="number" className="input-field" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <p className="mt-1 text-sm text-text-secondary">{t('pos.queue.change', 'Change:')} <span className="font-medium text-text-primary">{fmt(Math.max(0, Number(amount || 0) - order.total))}</span></p>
                  </div>
                )}
              </>
            )}
            {qr && (
              <div className="mt-4 text-center">
                <p className="text-sm text-text-secondary mb-2">{t('pos.queue.scanQris', 'Scan with any QRIS app to pay')}</p>
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`} alt={t('pos.queue.qrisAlt', 'QRIS payment code')} className="mx-auto rounded-lg border border-border" width={220} height={220} />
                <p className="mt-3 text-sm text-text-secondary flex items-center justify-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />{t('pos.queue.waiting', 'Waiting for payment…')}</p>
              </div>
            )}
          </>
        )}
        <div className="flex gap-2 justify-end mt-5">
          <button className="btn-secondary" onClick={onClose}>{qr ? t('pos.queue.close', 'Close') : t('pos.queue.cancel', 'Cancel')}</button>
          {order && !qr && <button className="btn-primary" onClick={confirm} disabled={busy}>{busy ? t('pos.queue.processing', 'Processing…') : method === 'qris_dynamic' ? t('pos.queue.generateQr', 'Generate QR') : t('pos.queue.confirmPayment', 'Confirm Payment')}</button>}
        </div>
      </div>
    </div>
  );
}
