'use client';

/**
 * POS Sell Pack — sell membership plans and voucher packs.
 *
 * Membership: real plans → customer + order + pending membership → payment →
 *   plate registration → activation.
 * Voucher pack: real catalog → customer + order → payment → code generation +
 *   WhatsApp delivery to the customer's number entered in the form.
 *
 * Everything is wired to the real backend; no demo data.
 *
 * Requirements: 14.1, 14.2, 14.4, 18.1, 18.2, 18.3
 */

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

type Tab = 'membership' | 'voucher';

interface MembershipPlan {
  id: string;
  name: string;
  price: number;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  discountedServices: { serviceId: string; discountPct: number }[];
}

interface VoucherTemplate {
  id: string;
  name: string;
  type: 'fixed' | 'percentage' | 'service_pack';
  value: number;
  maxUses: number;
  salePrice: number;
  validityDays: number | null;
}

interface SaleOrder {
  id: string;
  orderNumber: string;
  total: number;
}

interface MembershipSale {
  kind: 'membership';
  order: SaleOrder;
  membershipId: string;
  maxPlates: number;
  planName: string;
}

interface VoucherSale {
  kind: 'voucher';
  order: SaleOrder;
  templateId: string;
  templateName: string;
  packSize: number;
}

type Sale = MembershipSale | VoucherSale;

interface IssuedPack {
  parentCode: string;
  childCodes: string[];
  expiryDate: string | null;
  whatsappDelivered: boolean;
}

interface PlateEntry {
  plate: string;
  brand: string;
  model: string;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

const voucherSummary = (t: VoucherTemplate): string => {
  const benefit =
    t.type === 'fixed'
      ? `${fmt(t.value)} off`
      : t.type === 'percentage'
        ? `${t.value}% off`
        : 'prepaid service';
  const validity = t.validityDays ? ` · valid ${t.validityDays} days` : '';
  return `${t.maxUses} codes · ${benefit}${validity}`;
};

export default function SellPackPage() {
  const params = useParams();
  const [tab, setTab] = useState<Tab>('membership');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);

  // selection + customer
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<VoucherTemplate | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // sale + payment
  const [sale, setSale] = useState<Sale | null>(null);
  const [selling, setSelling] = useState(false);
  const [payMethod, setPayMethod] = useState<'cash' | 'qris_dynamic' | 'edc' | 'transfer'>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [paying, setPaying] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [paid, setPaid] = useState(false);

  // membership activation
  const [plates, setPlates] = useState<PlateEntry[]>([{ plate: '', brand: '', model: '' }]);
  const [activating, setActivating] = useState(false);
  const [done, setDone] = useState(false);

  // voucher issuance
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedPack | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    Promise.all([
      api.get<MembershipPlan[]>('/membership-plans').catch(() => []),
      api.get<VoucherTemplate[]>('/voucher-packs/catalog').catch(() => []),
    ])
      .then(([p, t]) => {
        setPlans(p);
        setTemplates(t);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load catalog'))
      .finally(() => setLoading(false));
  }, []);

  const startSale = async () => {
    setError('');
    if (!name.trim() || !phone.trim()) {
      setError('Enter the customer name and WhatsApp number.');
      return;
    }
    setSelling(true);
    try {
      if (tab === 'membership' && selectedPlan) {
        const r = await api.post<{ order: SaleOrder; membershipId: string; maxPlates: number; planName: string }>(
          '/memberships/sell',
          { planId: selectedPlan.id, customer: { name: name.trim(), phone: phone.trim() } },
        );
        setSale({ kind: 'membership', ...r });
        setAmountReceived(String(r.order.total));
      } else if (tab === 'voucher' && selectedTemplate) {
        const r = await api.post<{ order: SaleOrder; templateId: string; templateName: string; packSize: number }>(
          '/voucher-packs/sell',
          { templateId: selectedTemplate.id, customer: { name: name.trim(), phone: phone.trim() } },
        );
        setSale({ kind: 'voucher', ...r });
        setAmountReceived(String(r.order.total));
      }
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

  // Auto-issue voucher codes once a voucher sale is paid.
  useEffect(() => {
    if (paid && sale?.kind === 'voucher' && !issued && !issuing) {
      setIssuing(true);
      api
        .post<IssuedPack>('/voucher-packs/issue', { orderId: sale.order.id, templateId: sale.templateId })
        .then((r) => setIssued(r))
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to issue voucher codes'))
        .finally(() => setIssuing(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid, sale, issued, issuing]);

  const updatePlate = (i: number, field: keyof PlateEntry, value: string) =>
    setPlates((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  const addPlate = () => {
    if (sale?.kind === 'membership' && plates.length < sale.maxPlates) {
      setPlates((prev) => [...prev, { plate: '', brand: '', model: '' }]);
    }
  };
  const removePlate = (i: number) => setPlates((prev) => prev.filter((_, idx) => idx !== i));

  const activate = async () => {
    if (sale?.kind !== 'membership') return;
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
    setSelectedPlan(null);
    setSelectedTemplate(null);
    setName('');
    setPhone('');
    setSale(null);
    setQr(null);
    setPolling(false);
    setPaid(false);
    setPaying(false);
    setPlates([{ plate: '', brand: '', model: '' }]);
    setActivating(false);
    setDone(false);
    setIssuing(false);
    setIssued(null);
    setError('');
  };

  const user = getUser();
  const selected = tab === 'membership' ? selectedPlan : selectedTemplate;
  const selectedPrice = tab === 'membership' ? selectedPlan?.price : selectedTemplate?.salePrice;

  if (loading) {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">Loading…</div>;
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

      {/* Tabs */}
      <div className="px-5 pt-4">
        <div className="inline-flex rounded-lg bg-surface-sunken p-1">
          <button
            onClick={() => setTab('membership')}
            className={`px-4 py-1.5 text-sm rounded-md ${tab === 'membership' ? 'bg-surface-raised shadow-sm font-medium text-text-primary' : 'text-text-secondary'}`}
          >
            Membership Plans
          </button>
          <button
            onClick={() => setTab('voucher')}
            className={`px-4 py-1.5 text-sm rounded-md ${tab === 'voucher' ? 'bg-surface-raised shadow-sm font-medium text-text-primary' : 'text-text-secondary'}`}
          >
            Voucher Packs
          </button>
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-3 gap-5 p-5 min-h-0">
        {/* Catalog */}
        <div className="lg:col-span-2">
          {tab === 'membership' ? (
            <>
              <h2 className="section-title mb-3">Membership Plans</h2>
              {plans.length === 0 ? (
                <div className="card text-sm text-text-muted">No membership plans yet. Create them in the dashboard.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {plans.map((plan) => {
                    const isSel = selectedPlan?.id === plan.id;
                    return (
                      <button key={plan.id} onClick={() => setSelectedPlan(plan)} className={`card text-left transition-all active:scale-[0.99] ${isSel ? 'border-primary-400 ring-2 ring-primary-100' : 'hover:border-primary-300 hover:shadow-md'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-text-primary">{plan.name}</p>
                          <span className="text-primary-600 font-semibold whitespace-nowrap">{fmt(plan.price)}</span>
                        </div>
                        <div className="mt-2 text-sm text-text-secondary space-y-0.5">
                          <p>{plan.durationMonths} month{plan.durationMonths > 1 ? 's' : ''} · {plan.maxUses} washes · {plan.dailyLimit}/day</p>
                          <p>Up to {plan.maxPlates} plate{plan.maxPlates > 1 ? 's' : ''}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="section-title mb-3">Voucher Packs</h2>
              {templates.length === 0 ? (
                <div className="card text-sm text-text-muted">No voucher packs configured. Create voucher templates in the dashboard.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map((t) => {
                    const isSel = selectedTemplate?.id === t.id;
                    return (
                      <button key={t.id} onClick={() => setSelectedTemplate(t)} className={`card text-left transition-all active:scale-[0.99] ${isSel ? 'border-primary-400 ring-2 ring-primary-100' : 'hover:border-primary-300 hover:shadow-md'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-text-primary">{t.name}</p>
                          <span className="text-primary-600 font-semibold whitespace-nowrap">{fmt(t.salePrice)}</span>
                        </div>
                        <p className="mt-2 text-sm text-text-secondary">{voucherSummary(t)}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <h2 className="section-title mb-3">Sale</h2>
          {!selected ? (
            <p className="text-sm text-text-muted italic">Select a {tab === 'membership' ? 'plan' : 'voucher pack'} to begin.</p>
          ) : (
            <>
              <div className="rounded-lg bg-surface-sunken p-3 mb-4">
                <div className="flex justify-between items-start">
                  <span className="font-medium text-text-primary">{tab === 'membership' ? selectedPlan!.name : selectedTemplate!.name}</span>
                  <span className="text-primary-600 font-semibold">{fmt(selectedPrice ?? 0)}</span>
                </div>
                <p className="text-xs text-text-muted mt-1">
                  {tab === 'membership'
                    ? `${selectedPlan!.durationMonths}mo · ${selectedPlan!.maxUses} washes · max ${selectedPlan!.maxPlates} plates`
                    : voucherSummary(selectedTemplate!)}
                </p>
              </div>
              <div className="space-y-2 mb-4">
                <input className="input-field" placeholder="Customer name *" value={name} onChange={(e) => setName(e.target.value)} />
                <input className="input-field" placeholder={tab === 'voucher' ? 'WhatsApp number (e.g. 08123…) *' : 'Phone (e.g. 08123…) *'} value={phone} onChange={(e) => setPhone(e.target.value)} />
                {tab === 'voucher' && <p className="text-xs text-text-muted">Voucher codes will be sent to this WhatsApp number.</p>}
              </div>
              <div className="mt-auto border-t border-border pt-3">
                <div className="flex justify-between text-base font-semibold mb-3"><span>Total</span><span className="text-primary-600">{fmt(selectedPrice ?? 0)}</span></div>
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
            <div className="mt-4 flex justify-between text-base font-semibold border-b border-border pb-3">
              <span>{sale.kind === 'membership' ? sale.planName : sale.templateName}</span>
              <span className="text-primary-600">{fmt(sale.order.total)}</span>
            </div>

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
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`} alt="QRIS payment code" className="mx-auto rounded-lg border border-border" width={220} height={220} />
                <p className="mt-3 text-sm text-text-secondary flex items-center justify-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Waiting for payment confirmation…
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-secondary" onClick={reset} disabled={paying && !qr}>Cancel</button>
              {!qr && (
                <button className="btn-primary" onClick={confirmPayment} disabled={paying}>
                  {paying ? 'Processing…' : payMethod === 'qris_dynamic' ? 'Generate QR' : 'Confirm Payment'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Membership: vehicle registration */}
      {sale?.kind === 'membership' && paid && !done && (
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
                  {plates.length > 1 && <button onClick={() => removePlate(i)} className="w-9 h-9 rounded bg-surface-sunken text-text-secondary shrink-0">✕</button>}
                </div>
              ))}
            </div>
            {plates.length < sale.maxPlates && <button onClick={addPlate} className="btn-ghost mt-3 text-sm">+ Add Vehicle</button>}
            <div className="flex justify-end mt-5">
              <button className="btn-primary" onClick={activate} disabled={activating}>{activating ? 'Activating…' : 'Save & Activate'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Voucher: issued codes */}
      {sale?.kind === 'voucher' && paid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md">
            {issuing && <p className="text-sm text-text-secondary">Generating voucher codes…</p>}
            {issued && (
              <>
                <div className="text-center">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
                  <h3 className="text-lg font-semibold text-text-primary">Voucher Pack Sold</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    {issued.whatsappDelivered ? 'Codes sent to the customer via WhatsApp.' : 'Codes generated. WhatsApp delivery pending — share them now.'}
                  </p>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-text-muted mb-1">Pack code: <span className="font-mono">{issued.parentCode}</span>{issued.expiryDate ? ` · expires ${issued.expiryDate}` : ''}</p>
                  <div className="rounded-lg border border-border bg-surface-sunken p-3 max-h-48 overflow-auto grid grid-cols-2 gap-1.5">
                    {issued.childCodes.map((c) => (
                      <span key={c} className="font-mono text-sm text-text-primary">{c}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-text-muted">These codes are shown once. The customer can redeem them at checkout.</p>
                </div>
                <button className="btn-primary w-full mt-5" onClick={reset}>Sell Another</button>
              </>
            )}
            {!issuing && !issued && (
              <div className="text-center">
                <p className="text-sm text-red-600">{error || 'Issuing voucher codes…'}</p>
                <button className="btn-secondary w-full mt-4" onClick={reset}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Membership success */}
      {done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-sm text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">✓</span></div>
            <h3 className="text-lg font-semibold text-text-primary">Membership Activated</h3>
            <p className="text-sm text-text-secondary mt-1">{sale?.kind === 'membership' ? sale.planName : ''} for {name}</p>
            <button className="btn-primary w-full mt-5" onClick={reset}>Sell Another</button>
          </div>
        </div>
      )}
    </div>
  );
}
