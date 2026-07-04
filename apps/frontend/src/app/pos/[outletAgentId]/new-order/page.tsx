'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { PosNav } from '@/components/pos/PosNav';

interface ServiceDTO {
  id: string;
  name: string;
  category: 'car_wash' | 'product' | 'add_on';
  businessUnit: 'AIRE' | 'LEAD';
  price: number;
  isActive: boolean;
}

interface PaymentMethodDTO {
  id: string;
  name: string;
  kind: 'cash' | 'qris' | 'edc' | 'cc' | 'transfer';
  businessUnit: 'AIRE' | 'LEAD' | null;
  logoUrl: string | null;
  color: string;
}

interface CartLine {
  serviceId: string;
  name: string;
  price: number;
  qty: number;
}

interface CreatedOrder {
  id: string;
  orderNumber: string;
  total: number;
  subtotal: number;
  serviceCharge: number;
  tax: number;
  voucherDiscount: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  car_wash: 'Car Wash',
  add_on: 'Add-on',
  product: 'Product',
};

export default function NewOrderPage() {
  const params = useParams();
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [businessUnit, setBusinessUnit] = useState<'AIRE' | 'LEAD'>('AIRE');
  const [salesperson, setSalesperson] = useState('');
  const [payMethods, setPayMethods] = useState<PaymentMethodDTO[]>([]);
  const [selectedPmId, setSelectedPmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);

  // voucher redemption
  const [voucherCodes, setVoucherCodes] = useState<string[]>([]);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucherMsg, setVoucherMsg] = useState('');
  const [checkingVoucher, setCheckingVoucher] = useState(false);

  // payment state
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [payMethod, setPayMethod] = useState<'cash' | 'qris_dynamic' | 'edc' | 'cc' | 'transfer'>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [paying, setPaying] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [receipt, setReceipt] = useState<{ orderNumber: string; total: number; change: number } | null>(null);
  // The branch this POS is operating. POS follows the HR schedule: it's today's
  // scheduled branch when set, otherwise the operator's home outlet.
  const [operatingOutletId, setOperatingOutletId] = useState<string | null>(null);
  const [scheduledOutletId, setScheduledOutletId] = useState<string | null>(null);
  const [homeOutletId, setHomeOutletId] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [offScheduleReason, setOffScheduleReason] = useState('');

  // Load the service catalog + payment methods for a branch (pricing is
  // branch-specific). Called on mount and whenever the operator switches branch.
  const loadCatalog = useCallback((outletId: string | null) => {
    const svcUrl = outletId ? `/services?outletId=${outletId}` : '/services';
    api.get<ServiceDTO[]>(svcUrl)
      .then((data) => setServices(data.filter((s) => s.isActive)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load services'))
      .finally(() => setLoading(false));
    const pmUrl = outletId ? `/payment-methods?active=true&outletId=${outletId}` : '/payment-methods?active=true';
    api.get<PaymentMethodDTO[]>(pmUrl).then(setPayMethods).catch(() => { /* default buttons */ });
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    const u = getUser();
    setHomeOutletId(u?.outletId ?? null);
    // POS follows the HR schedule: default to today's scheduled branch, else home.
    api.get<{ todayOutletId: string | null; branches: { id: string; name: string }[] }>('/hr/my/branch-context')
      .then((ctx) => {
        setBranches(ctx?.branches ?? []);
        setScheduledOutletId(ctx?.todayOutletId ?? null);
        const active = ctx?.todayOutletId ?? u?.outletId ?? null;
        setOperatingOutletId(active);
        loadCatalog(active);
      })
      .catch(() => { const active = u?.outletId ?? null; setOperatingOutletId(active); loadCatalog(active); });
  }, [loadCatalog]);

  // Manually switch the operating branch. Clears the cart (branch pricing differs).
  const changeBranch = (id: string) => {
    if (id === operatingOutletId) return;
    setOperatingOutletId(id);
    setOffScheduleReason('');
    setCart([]);
    loadCatalog(id);
  };

  // Operating a branch that is neither the operator's home nor today's scheduled
  // one — the backend requires (and audit-logs) a reason for this.
  const offSchedule = !!operatingOutletId && operatingOutletId !== homeOutletId && operatingOutletId !== scheduledOutletId;

  const addToCart = useCallback((s: ServiceDTO) => {
    setCart((prev) => {
      const found = prev.find((l) => l.serviceId === s.id);
      if (found) return prev.map((l) => l.serviceId === s.id ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, { serviceId: s.id, name: s.name, price: s.price, qty: 1 }];
    });
  }, []);

  const changeQty = (serviceId: string, delta: number) => {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.serviceId !== serviceId) return [l];
        const qty = l.qty + delta;
        return qty <= 0 ? [] : [{ ...l, qty }];
      }),
    );
  };

  const subtotal = cart.reduce((sum, l) => sum + l.price * l.qty, 0);
  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

  const applyVoucher = async () => {
    const code = voucherInput.trim();
    if (!code) return;
    if (voucherCodes.includes(code)) {
      setVoucherMsg('Code already added');
      return;
    }
    setCheckingVoucher(true);
    setVoucherMsg('');
    try {
      const res = await api.post<{ status: string; message: string; discountAmount?: number }>(
        '/vouchers/validate',
        { code, serviceIdsInCart: cart.map((l) => l.serviceId), orderSubtotal: subtotal },
      );
      if (res.status === 'valid_applicable') {
        setVoucherCodes((prev) => [...prev, code]);
        setVoucherInput('');
        setVoucherMsg(`Applied: −${fmt(res.discountAmount ?? 0)}`);
      } else {
        setVoucherMsg(res.message || 'Voucher cannot be applied');
      }
    } catch (e) {
      setVoucherMsg(e instanceof Error ? e.message : 'Validation failed');
    } finally {
      setCheckingVoucher(false);
    }
  };

  const removeVoucher = (code: string) => {
    setVoucherCodes((prev) => prev.filter((c) => c !== code));
    setVoucherMsg('');
  };

  const placeOrder = async () => {
    setError('');
    if (!name.trim() || !phone.trim() || cart.length === 0) {
      setError('Enter customer name, phone, and add at least one service.');
      return;
    }
    if (offSchedule && !offScheduleReason.trim()) {
      setError('Enter a reason for operating an off-schedule branch.');
      return;
    }
    setPlacing(true);
    try {
      const created = await api.post<CreatedOrder>('/orders', {
        customer: { name: name.trim(), phone: phone.trim(), licensePlate: plate.trim() || undefined, brand: brand.trim() || undefined, model: model.trim() || undefined },
        items: cart.map((l) => ({ serviceId: l.serviceId, quantity: l.qty })),
        businessUnit,
        salespersonName: salesperson.trim() || undefined,
        voucherCodes: voucherCodes.length ? voucherCodes : undefined,
        operatingOutletId: operatingOutletId ?? undefined,
        offScheduleReason: offSchedule ? offScheduleReason.trim() : undefined,
      });
      setOrder(created);
      setAmountReceived(String(created.total));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to place order');
    } finally {
      setPlacing(false);
    }
  };

  const confirmPayment = async () => {
    if (!order) return;
    setPaying(true);
    setError('');
    try {
      if (payMethod === 'qris_dynamic') {
        // Initiate a gateway QRIS charge and wait for webhook confirmation
        const charge = await api.post<{ qrString: string }>(`/payments/charge/${order.id}`);
        setQr(charge.qrString);
        setPolling(true);
        return;
      }
      await api.post(`/orders/${order.id}/pay`, {
        method: payMethod,
        paymentChannel: payMethods.find((m) => m.id === selectedPmId)?.businessUnit ?? businessUnit,
        amountReceived: payMethod === 'cash' ? Number(amountReceived) : undefined,
      });
      const change = payMethod === 'cash' ? Math.max(0, Number(amountReceived) - order.total) : 0;
      finishSale(order.orderNumber, order.total, change);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  const finishSale = (orderNumber: string, total: number, change: number) => {
    setReceipt({ orderNumber, total, change });
    setCart([]); setName(''); setPhone(''); setPlate(''); setBrand(''); setModel('');
    setVoucherCodes([]); setVoucherInput(''); setVoucherMsg('');
    setOrder(null); setQr(null); setPolling(false); setPaying(false); setSelectedPmId(null);
  };

  // Poll order status while waiting for QRIS gateway confirmation
  useEffect(() => {
    if (!polling || !order) return;
    const id = setInterval(async () => {
      try {
        const o = await api.get<{ status: string; orderNumber: string; total: number }>(`/orders/${order.id}`);
        if (o.status === 'paid') {
          clearInterval(id);
          finishSale(o.orderNumber, o.total, 0);
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [polling, order]);

  const visibleServices = services.filter((s) => (s.businessUnit ?? 'AIRE') === businessUnit);

  if (loading) {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">Loading POS…</div>;
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <PosNav
        agent={params.outletAgentId as string}
        active="new-order"
        title="Point of Sale"
        subtitle={`Agent: ${params.outletAgentId as string}`}
      />

      {error && <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Operating branch — follows the HR schedule; can be overridden with a reason. */}
      {branches.length > 0 && (
        <div className="mx-5 mt-4 flex items-center gap-3 flex-wrap">
          <label htmlFor="pos-branch" className="text-sm text-text-muted">Operating branch</label>
          <select
            id="pos-branch"
            aria-label="Operating branch"
            className="input-field py-1 max-w-[240px]"
            value={operatingOutletId ?? ''}
            onChange={(e) => changeBranch(e.target.value)}
          >
            {operatingOutletId == null && <option value="">Select branch…</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.id === scheduledOutletId ? ' — scheduled' : ''}</option>
            ))}
          </select>
          {operatingOutletId && operatingOutletId === scheduledOutletId && (
            <span className="badge bg-green-50 text-green-700 text-xs">On schedule</span>
          )}
          {offSchedule && (
            <input
              className="input-field py-1 flex-1 min-w-[220px]"
              aria-label="Off-schedule reason"
              placeholder="Reason for off-schedule branch (required — logged)"
              value={offScheduleReason}
              onChange={(e) => setOffScheduleReason(e.target.value)}
            />
          )}
        </div>
      )}

      <div className="flex-1 grid lg:grid-cols-3 gap-5 p-5 min-h-0">
        {/* Service grid */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Services</h2>
            {/* Business unit switch — AIRE car wash vs LEAD detailing */}
            <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5" role="group" aria-label="Business unit">
              {(['AIRE', 'LEAD'] as const).map((bu) => (
                <button
                  key={bu}
                  onClick={() => { if (bu !== businessUnit) { setBusinessUnit(bu); setCart([]); } }}
                  className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                    businessUnit === bu ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {bu === 'AIRE' ? 'AIRE · Wash' : 'LEAD · Detail'}
                </button>
              ))}
            </div>
          </div>
          {visibleServices.length === 0 ? (
            <div className="card text-sm text-text-muted">No active {businessUnit} services. Add some in the dashboard.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {visibleServices.map((s) => (
                <button
                  key={s.id}
                  onClick={() => addToCart(s)}
                  className="card text-left hover:border-primary-300 hover:shadow-md transition-all active:scale-[0.98]"
                >
                  <span className="badge bg-primary-50 text-primary-700 mb-2">{CATEGORY_LABELS[s.category]}</span>
                  <p className="font-medium text-text-primary text-sm">{s.name}</p>
                  <p className="text-primary-600 font-semibold mt-1">{fmt(s.price)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <h2 className="section-title mb-3">Order</h2>

          <div className="space-y-2 mb-4">
            <input className="input-field" placeholder="Customer name *" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input-field" placeholder="Phone (e.g. 08123…) *" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="input-field" placeholder="License plate (optional)" value={plate} onChange={(e) => setPlate(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" placeholder="Vehicle brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <input className="input-field" placeholder="Vehicle type" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <input className="input-field" placeholder="Salesperson (optional)" value={salesperson} onChange={(e) => setSalesperson(e.target.value)} />
          </div>

          <div className="flex-1 overflow-auto border-t border-border pt-3 space-y-2 min-h-[120px]">
            {cart.length === 0 ? (
              <p className="text-sm text-text-muted italic">Tap services to add them to the order.</p>
            ) : cart.map((l) => (
              <div key={l.serviceId} className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{l.name}</p>
                  <p className="text-xs text-text-muted">{fmt(l.price)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => changeQty(l.serviceId, -1)} className="w-6 h-6 rounded bg-surface-sunken text-text-primary">−</button>
                  <span className="w-6 text-center text-sm">{l.qty}</span>
                  <button onClick={() => changeQty(l.serviceId, 1)} className="w-6 h-6 rounded bg-surface-sunken text-text-primary">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Voucher Code</label>
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder="Enter code"
                value={voucherInput}
                onChange={(e) => setVoucherInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyVoucher(); } }}
              />
              <button onClick={applyVoucher} disabled={checkingVoucher || !voucherInput.trim()} className="btn-secondary">
                {checkingVoucher ? '…' : 'Apply'}
              </button>
            </div>
            {voucherMsg && <p className="mt-1 text-xs text-text-secondary">{voucherMsg}</p>}
            {voucherCodes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {voucherCodes.map((c) => (
                  <span key={c} className="badge bg-primary-50 text-primary-700 flex items-center gap-1">
                    {c}
                    <button onClick={() => removeVoucher(c)} className="text-primary-400 hover:text-primary-700">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">Subtotal</span><span className="font-medium">{fmt(subtotal)}</span></div>
            <p className="text-xs text-text-muted mb-3">Service charge &amp; tax calculated at order time.</p>
            <button onClick={placeOrder} disabled={placing || cart.length === 0} className="btn-primary w-full">
              {placing ? 'Placing…' : 'Place Order'}
            </button>
          </div>
        </div>
      </div>

      {/* Payment modal */}
      {order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md">
            <h3 className="section-title">Payment — {order.orderNumber}</h3>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-secondary">Subtotal</span><span>{fmt(order.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">Service charge</span><span>{fmt(order.serviceCharge)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">Tax</span><span>{fmt(order.tax)}</span></div>
              {order.voucherDiscount > 0 && <div className="flex justify-between"><span className="text-text-secondary">Voucher</span><span className="text-green-600">−{fmt(order.voucherDiscount)}</span></div>}
              <div className="flex justify-between text-base font-semibold border-t border-border pt-2 mt-2"><span>Total</span><span className="text-primary-600">{fmt(order.total)}</span></div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1.5">Payment Method</label>
              {payMethods.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {payMethods.map((pm) => {
                    const mapped = pm.kind === 'qris' ? 'qris_dynamic' : pm.kind;
                    const active = selectedPmId === pm.id;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        disabled={polling}
                        onClick={() => { setSelectedPmId(pm.id); setPayMethod(mapped as typeof payMethod); }}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-all ${active ? 'border-primary-500 ring-2 ring-primary-100' : 'border-border hover:border-border-strong'}`}
                      >
                        <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: pm.color }}>
                          {pm.logoUrl ? <img src={pm.logoUrl} alt="" className="w-6 h-6 object-contain" /> : pm.kind.toUpperCase().slice(0, 3)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-text-primary truncate">{pm.name}</span>
                          <span className="block text-[11px] text-text-muted">{pm.kind.toUpperCase()}{pm.businessUnit ? ` · ${pm.businessUnit}` : ''}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <select aria-label="Payment method" className="input-field" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} disabled={polling}>
                  <option value="cash">Cash</option>
                  <option value="qris_dynamic">QRIS (scan to pay)</option>
                  <option value="edc">EDC / Debit</option>
                  <option value="cc">Credit Card</option>
                  <option value="transfer">Bank Transfer</option>
                </select>
              )}
              {payMethod !== 'cash' && (
                <p className="mt-1.5 text-xs text-text-muted">Settles to the <span className="font-medium text-text-primary">{payMethods.find((m) => m.id === selectedPmId)?.businessUnit ?? businessUnit}</span> account.</p>
              )}
            </div>

            {payMethod === 'cash' && !qr && (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1.5">Amount Received</label>
                <input aria-label="Amount received" type="number" className="input-field" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                <p className="mt-1 text-sm text-text-secondary">Change: <span className="font-medium text-text-primary">{fmt(Math.max(0, Number(amountReceived || 0) - order.total))}</span></p>
              </div>
            )}

            {qr && (
              <div className="mt-4 text-center">
                <p className="text-sm text-text-secondary mb-2">Scan with any QRIS app to pay</p>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`}
                  alt="QRIS payment code"
                  className="mx-auto rounded-lg border border-border"
                  width={220}
                  height={220}
                />
                <p className="mt-3 text-sm text-text-secondary flex items-center justify-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Waiting for payment confirmation…
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-secondary" onClick={() => { setOrder(null); setQr(null); setPolling(false); }} disabled={paying && !qr}>
                {qr ? 'Close' : 'Cancel'}
              </button>
              {!qr && (
                <button className="btn-primary" onClick={confirmPayment} disabled={paying}>
                  {paying ? 'Processing…' : payMethod === 'qris_dynamic' ? 'Generate QR' : 'Confirm Payment'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receipt / success */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReceipt(null)}>
          <div className="card w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
            <h3 className="text-lg font-semibold text-text-primary">Payment Successful</h3>
            <p className="text-sm text-text-secondary mt-1">Order {receipt.orderNumber}</p>
            <div className="mt-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-text-secondary">Total Paid</span><span className="font-medium">{fmt(receipt.total)}</span></div>
              {receipt.change > 0 && <div className="flex justify-between"><span className="text-text-secondary">Change</span><span className="font-medium">{fmt(receipt.change)}</span></div>}
            </div>
            <button className="btn-primary w-full mt-5" onClick={() => setReceipt(null)}>New Order</button>
          </div>
        </div>
      )}
    </div>
  );
}
