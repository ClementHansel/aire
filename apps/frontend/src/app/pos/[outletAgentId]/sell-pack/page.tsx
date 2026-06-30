'use client';

/**
 * POS Sell Pack — sell membership plans.
 * Wired end-to-end to the real backend: lists the tenant's active membership
 * plans, creates a customer + order + pending membership, settles payment via
 * the standard flow (cash / QRIS / EDC / transfer), then registers vehicle
 * plates and activates the membership.
 *
 * Requirements: 14.1, 14.2, 14.4
 */

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface DiscountedService {
  serviceId: string;
  serviceName?: string;
  discountPct: number;
}

interface MembershipPlan {
  id: string;
  name: string;
  price: number;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  freeServiceIds: string[] | null;
  discountedServices: DiscountedService[];
}

interface SellResult {
  order: { id: string; orderNumber: string; total: number };
  membershipId: string;
  maxPlates: number;
  planName: string;
}

interface PlateEntry {
  plate: string;
  brand: string;
  model: string;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function SellPackPage() {
  const params = useParams();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // cart / customer
  const [selected, setSelected] = useState<MembershipPlan | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // sale + payment
  const [sale, setSale] = useState<SellResult | null>(null);
  const [selling, setSelling] = useState(false);
  const [payMethod, setPayMethod] = useState<'cash' | 'qris_dynamic' | 'edc' | 'transfer'>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [paying, setPaying] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [paid, setPaid] = useState(false);

  // vehicle registration
  const [plates, setPlates] = useState<PlateEntry[]>([{ plate: '', brand: '', model: '' }]);
  const [activating, setActivating] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    api
      .get<MembershipPlan[]>('/membership-plans')
      .then((data) => setPlans(data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load plans'))
      .finally(() => setLoading(false));
  }, []);

  const startSale = async () => {
    setError('');
    if (!selected) return;
    if (!name.trim() || !phone.trim()) {
      setError('Enter the customer name and phone.');
      return;
    }
    setSelling(true);
    try {
      const result = await api.post<SellResult>('/memberships/sell', {
        planId: selected.id,
        customer: { name: name.trim(), phone: phone.trim() },
      });
      setSale(result);
      setAmountReceived(String(result.order.total));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start sale');
    } finally {
      setSelling(false);
    }
  };

  const confirmPayment = async () => {
    if (!sale) return;
    setPaying(true);
    setError('');
    try {
      if (payMethod === 'qris_dynamic') {
        const charge = await api.post<{ qrString: string }>(`/payments/charge/${sale.order.id}`);
        setQr(charge.qrString);
        setPolling(true);
        return;
      }
      await api.post(`/orders/${sale.order.id}/pay`, {
        method: payMethod,
        amountReceived: payMethod === 'cash' ? Number(amountReceived) : undefined,
      });
      setPaid(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  // Poll order status while waiting for QRIS confirmation
  useEffect(() => {
    if (!polling || !sale) return;
    const id = setInterval(async () => {
      try {
        const o = await api.get<{ status: string }>(`/orders/${sale.order.id}`);
        if (o.status === 'paid') {
          clearInterval(id);
          setPolling(false);
          setPaid(true);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, sale]);

  const updatePlate = (i: number, field: keyof PlateEntry, value: string) => {
    setPlates((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  };

  const addPlate = () => {
    if (sale && plates.length < sale.maxPlates) {
      setPlates((prev) => [...prev, { plate: '', brand: '', model: '' }]);
    }
  };

  const removePlate = (i: number) => setPlates((prev) => prev.filter((_, idx) => idx !== i));

  const activate = async () => {
    if (!sale) return;
    const valid = plates.filter((p) => p.plate.trim() !== '');
    if (valid.length === 0) {
      setError('Register at least one plate.');
      return;
    }
    setActivating(true);
    setError('');
    try {
      await api.post(`/memberships/${sale.membershipId}/activate`, { plates: valid });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setActivating(false);
    }
  };

  const reset = () => {
    setSelected(null);
    setName('');
    setPhone('');
    setSale(null);
    setQr(null);
    setPolling(false);
    setPaid(false);
    setPaying(false);
    setPlates([{ plate: '', brand: '', model: '' }]);
    setDone(false);
    setError('');
  };

  const user = getUser();

  if (loading) {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">Loading plans…</div>;
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="bg-surface-raised border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center"><span className="text-sm font-bold text-white">A</span></div>
            <div>
              <p className="font-semibold text-text-primary text-sm">Sell Pack</p>
              <p className="text-xs text-text-muted">Agent: {params.outletAgentId as string}</p>
            </div>
          </div>
          <nav className="hidden sm:flex gap-1 text-sm">
            <a href={`/pos/${params.outletAgentId}/new-order`} className="btn-ghost py-1.5 px-3">New Order</a>
            <span className="btn-ghost py-1.5 px-3 bg-surface-sunken">Sell Pack</span>
            <a href={`/pos/${params.outletAgentId}/orders`} className="btn-ghost py-1.5 px-3">Orders</a>
            <a href={`/pos/${params.outletAgentId}/summary`} className="btn-ghost py-1.5 px-3">Summary</a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">{user?.name}</span>
          <button onClick={logout} className="text-xs text-text-secondary hover:text-text-primary">Sign out</button>
        </div>
      </header>

      {error && <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex-1 grid lg:grid-cols-3 gap-5 p-5 min-h-0">
        {/* Plans */}
        <div className="lg:col-span-2">
          <h2 className="section-title mb-3">Membership Plans</h2>
          {plans.length === 0 ? (
            <div className="card text-sm text-text-muted">No membership plans yet. Create them in the dashboard.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plans.map((plan) => {
                const isSel = selected?.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    onClick={() => setSelected(plan)}
                    className={`card text-left transition-all active:scale-[0.99] ${isSel ? 'border-primary-400 ring-2 ring-primary-100' : 'hover:border-primary-300 hover:shadow-md'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-text-primary">{plan.name}</p>
                      <span className="text-primary-600 font-semibold whitespace-nowrap">{fmt(plan.price)}</span>
                    </div>
                    <div className="mt-2 text-sm text-text-secondary space-y-0.5">
                      <p>{plan.durationMonths} month{plan.durationMonths > 1 ? 's' : ''} · {plan.maxUses} washes · {plan.dailyLimit}/day</p>
                      <p>Up to {plan.maxPlates} plate{plan.maxPlates > 1 ? 's' : ''}</p>
                      {plan.discountedServices?.length > 0 && (
                        <p className="text-text-muted">{plan.discountedServices.length} discounted service{plan.discountedServices.length > 1 ? 's' : ''}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <h2 className="section-title mb-3">Sale</h2>
          {!selected ? (
            <p className="text-sm text-text-muted italic">Select a membership plan to begin.</p>
          ) : (
            <>
              <div className="rounded-lg bg-surface-sunken p-3 mb-4">
                <div className="flex justify-between items-start">
                  <span className="font-medium text-text-primary">{selected.name}</span>
                  <span className="text-primary-600 font-semibold">{fmt(selected.price)}</span>
                </div>
                <p className="text-xs text-text-muted mt-1">{selected.durationMonths}mo · {selected.maxUses} washes · max {selected.maxPlates} plates</p>
              </div>
              <div className="space-y-2 mb-4">
                <input className="input-field" placeholder="Customer name *" value={name} onChange={(e) => setName(e.target.value)} />
                <input className="input-field" placeholder="Phone (e.g. 08123…) *" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="mt-auto border-t border-border pt-3">
                <div className="flex justify-between text-base font-semibold mb-3"><span>Total</span><span className="text-primary-600">{fmt(selected.price)}</span></div>
                <button onClick={startSale} disabled={selling} className="btn-primary w-full">
                  {selling ? 'Starting…' : 'Proceed to Payment'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payment modal */}
      {sale && !paid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md">
            <h3 className="section-title">Payment — {sale.order.orderNumber}</h3>
            <div className="mt-4 flex justify-between text-base font-semibold border-b border-border pb-3"><span>{sale.planName}</span><span className="text-primary-600">{fmt(sale.order.total)}</span></div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1.5">Payment Method</label>
              <select className="input-field" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} disabled={polling}>
                <option value="cash">Cash</option>
                <option value="qris_dynamic">QRIS (scan to pay)</option>
                <option value="edc">EDC / Card</option>
                <option value="transfer">Bank Transfer</option>
              </select>
            </div>

            {payMethod === 'cash' && !qr && (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1.5">Amount Received</label>
                <input type="number" className="input-field" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                <p className="mt-1 text-sm text-text-secondary">Change: <span className="font-medium text-text-primary">{fmt(Math.max(0, Number(amountReceived || 0) - sale.order.total))}</span></p>
              </div>
            )}

            {qr && (
              <div className="mt-4 text-center">
                <p className="text-sm text-text-secondary mb-2">Scan with any QRIS app to pay</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
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
              <button className="btn-secondary" onClick={reset} disabled={paying && !qr}>{qr ? 'Cancel' : 'Cancel'}</button>
              {!qr && (
                <button className="btn-primary" onClick={confirmPayment} disabled={paying}>
                  {paying ? 'Processing…' : payMethod === 'qris_dynamic' ? 'Generate QR' : 'Confirm Payment'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vehicle registration (post-payment) */}
      {sale && paid && !done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg">
            <h3 className="section-title">Register Vehicles</h3>
            <p className="text-sm text-text-secondary mt-1">Payment received. Register up to {sale.maxPlates} plate{sale.maxPlates > 1 ? 's' : ''} to activate the membership.</p>

            <div className="mt-4 space-y-3 max-h-[50vh] overflow-auto">
              {plates.map((p, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <input className="input-field" placeholder="Plate *" value={p.plate} onChange={(e) => updatePlate(i, 'plate', e.target.value)} />
                    <input className="input-field" placeholder="Brand" value={p.brand} onChange={(e) => updatePlate(i, 'brand', e.target.value)} />
                    <input className="input-field" placeholder="Model" value={p.model} onChange={(e) => updatePlate(i, 'model', e.target.value)} />
                  </div>
                  {plates.length > 1 && (
                    <button onClick={() => removePlate(i)} className="w-9 h-9 rounded bg-surface-sunken text-text-secondary shrink-0">✕</button>
                  )}
                </div>
              ))}
            </div>

            {plates.length < sale.maxPlates && (
              <button onClick={addPlate} className="btn-ghost mt-3 text-sm">+ Add Vehicle</button>
            )}

            <div className="flex justify-end mt-5">
              <button className="btn-primary" onClick={activate} disabled={activating}>
                {activating ? 'Activating…' : 'Save & Activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success */}
      {done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-sm text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
            <h3 className="text-lg font-semibold text-text-primary">Membership Activated</h3>
            <p className="text-sm text-text-secondary mt-1">{sale?.planName} for {name}</p>
            <button className="btn-primary w-full mt-5" onClick={reset}>Sell Another</button>
          </div>
        </div>
      )}
    </div>
  );
}
