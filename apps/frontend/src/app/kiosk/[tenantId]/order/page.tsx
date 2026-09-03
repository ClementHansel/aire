'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useI18n, LanguageToggle } from '@/lib/i18n';
import { QrScanButton } from '@/components/QrScanButton';
import { PaymentSandboxNote } from '@/components/shared/PaymentSandboxNote';
import { MembershipCard, type CardTemplate } from '@/components/dashboard/MembershipCard';
import { usePublicBranding } from '@/lib/publicBranding';
import { useResolveTenant } from '@/lib/resolveTenant';
import { LEAN_MODE } from '@aire/shared';
import { PlateInput } from '@/components/shared/PlateInput';
import { AirinLogo } from '@/components/shared/AirinLogo';

/**
 * Self-service kiosk ordering: identify (optional) → pick products → details →
 * Pay now (QRIS) or Pay at cashier. Authorized by a per-device kiosk token
 * passed in the launch URL (?kioskToken=…) and sent as the x-kiosk-token header.
 * The resulting order lands on the shared queue board (paid or unpaid).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface MenuItem {
  id: string;
  name: string;
  category: string;
  businessUnit: string;
  price: number;
  isMainService: boolean;
  available: boolean;
}
interface PublicMenu {
  tenantName: string;
  services: MenuItem[];
  products?: MenuItem[];
}
interface MemberLookupResp {
  customer: { id: string; name: string; phone: string; membershipNumber?: string; plates: { plate: string; brand?: string; model?: string }[] };
  memberships: { id: string; planName: string; status: string; endDate?: string }[];
}

/** end_date (YYYY-MM-DD) → "MM/YY" for the card's "valid until". */
function mmYY(endDate?: string): string {
  if (!endDate) return '';
  const d = new Date(endDate);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}
interface CartLine { serviceId: string; name: string; price: number; qty: number }
interface CreatedOrder { id: string; orderNumber: string; total: number }

type Step = 'identify' | 'products' | 'details' | 'pay' | 'done';

const CATEGORY_LABELS: Record<string, string> = {
  car_wash: 'Car Wash',
  add_on: 'Add-on',
  product: 'Product',
};

async function kioskApi<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-kiosk-token': token, ...(options.headers as Record<string, string>) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
  return body as T;
}

export default function KioskOrderPage() {
  const { id: tenantId, status } = useResolveTenant();
  // Customer self-order is held while lean — orders are taken at the POS by a
  // cashier. Send the device back to the kiosk status board.
  useEffect(() => {
    if (LEAN_MODE) window.location.href = tenantId ? `/kiosk/${tenantId}` : '/';
  }, [tenantId]);
  const { t } = useI18n();
  const tenantBrand = usePublicBranding(tenantId ?? undefined);

  const [token, setToken] = useState<string | null>(null);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [step, setStep] = useState<Step>('identify');
  const [businessUnit, setBusinessUnit] = useState<string>('AIRE');
  // Which menu tab is showing: a service business unit, or retail products.
  // A unit code, or the literal 'products' pseudo-tab.
  const [tab, setTab] = useState<string>('AIRE');
  const [cart, setCart] = useState<CartLine[]>([]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [selectedPlate, setSelectedPlate] = useState<string | null>(null);
  const [memberName, setMemberName] = useState<string | null>(null);
  // The identified member's card (design template + their number/validUntil).
  const [cardTemplate, setCardTemplate] = useState<CardTemplate | null>(null);
  const [memberCard, setMemberCard] = useState<{ number: string; validUntil: string } | null>(null);

  const [identifyInput, setIdentifyInput] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [identifyMsg, setIdentifyMsg] = useState('');

  const [placing, setPlacing] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [paidAtCashier, setPaidAtCashier] = useState(false);
  const [vehicleBrands, setVehicleBrands] = useState<{ id: string; name: string; types: { id: string; name: string }[] }[]>([]);

  // Read the device token from the launch URL, then load the public menu.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('kioskToken');
    setToken(t);
    if (!tenantId) return;
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
    fetch(`${base}/kiosk/menu?tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('menu'))))
      .then((m: PublicMenu) => setMenu(m))
      .catch(() => setError('Unable to load the menu. Please ask a staff member.'))
      .finally(() => setLoading(false));
    // Card design (optional) so an identified member can see their own card.
    fetch(`${base}/public/card-template?tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: CardTemplate | null) => { if (c && Array.isArray(c.elements)) setCardTemplate(c); })
      .catch(() => { /* card optional */ });
  }, [tenantId]);

  // Vehicle brand/type catalog (token-guarded) for the brand → type dropdowns.
  useEffect(() => {
    if (!token) return;
    kioskApi<{ id: string; name: string; types: { id: string; name: string }[] }[]>('/kiosk/vehicle-brands', token)
      .then(setVehicleBrands)
      .catch(() => { /* optional */ });
  }, [token]);

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);

  const identifyWith = useCallback(async (value: string) => {
    const q = value.trim();
    if (!token || !q) return;
    setIdentifyInput(q);
    setIdentifying(true); setIdentifyMsg('');
    try {
      const m = await kioskApi<MemberLookupResp | null>(
        `/kiosk/identify?q=${encodeURIComponent(q)}`, token,
      );
      if (m && m.customer) {
        setName(m.customer.name);
        setPhone(m.customer.phone);
        const p = m.customer.plates?.[0];
        if (p) { setPlate(p.plate); if (p.brand) setBrand(p.brand); if (p.model) setModel(p.model); setSelectedPlate(p.plate); }
        const active = m.memberships?.find((x) => x.status === 'active') ?? m.memberships?.[0];
        // Member pricing only for a genuinely active membership.
        if (active && active.status === 'active') setMembershipId(active.id);
        setMemberName(m.customer.name);
        // Show the member's own card if they have a membership number.
        if (m.customer.membershipNumber) {
          setMemberCard({ number: m.customer.membershipNumber, validUntil: mmYY(active?.endDate) });
        } else {
          setMemberCard(null);
        }
        setStep('products');
      } else {
        setIdentifyMsg('No member found for that. You can continue as a guest.');
      }
    } catch {
      setIdentifyMsg('Lookup unavailable. You can continue as a guest.');
    } finally {
      setIdentifying(false);
    }
  }, [token]);
  const runIdentify = () => identifyWith(identifyInput);

  const addToCart = (s: MenuItem) => {
    setCart((prev) => {
      const found = prev.find((l) => l.serviceId === s.id);
      if (found) return prev.map((l) => (l.serviceId === s.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { serviceId: s.id, name: s.name, price: s.price, qty: 1 }];
    });
  };
  const changeQty = (serviceId: string, delta: number) =>
    setCart((prev) => prev.flatMap((l) => {
      if (l.serviceId !== serviceId) return [l];
      const qty = l.qty + delta;
      return qty <= 0 ? [] : [{ ...l, qty }];
    }));

  const createOrder = async (): Promise<CreatedOrder | null> => {
    if (!token) return null;
    const created = await kioskApi<CreatedOrder>(`/kiosk/orders`, token, {
      method: 'POST',
      body: JSON.stringify({
        customer: {
          name: name.trim(), phone: phone.trim(),
          licensePlate: plate.trim() || undefined, brand: brand.trim() || undefined, model: model.trim() || undefined,
        },
        items: cart.map((l) => ({ serviceId: l.serviceId, quantity: l.qty })),
        businessUnit,
        membershipId: membershipId ?? undefined,
        selectedPlate: selectedPlate ?? undefined,
      }),
    });
    setCreatedOrder(created);
    return created;
  };

  const payNow = async () => {
    setError(''); setPlacing(true);
    try {
      const created = createdOrder ?? (await createOrder());
      if (!created || !token) return;
      const charge = await kioskApi<{ qrString: string }>(`/kiosk/orders/${created.id}/charge`, token, { method: 'POST' });
      setQr(charge.qrString);
      setPolling(true);
      setStep('pay');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment.');
    } finally {
      setPlacing(false);
    }
  };

  const payAtCashier = async () => {
    setError(''); setPlacing(true);
    try {
      const created = createdOrder ?? (await createOrder());
      if (!created) return;
      setPaidAtCashier(true);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place order.');
    } finally {
      setPlacing(false);
    }
  };

  // Poll for QRIS confirmation.
  useEffect(() => {
    if (!polling || !createdOrder || !token) return;
    const id = setInterval(async () => {
      try {
        const o = await kioskApi<{ status: string }>(`/kiosk/orders/${createdOrder.id}/status`, token);
        if (o.status === 'paid' || o.status === 'confirmed' || o.status === 'completed') {
          clearInterval(id);
          setPolling(false);
          setStep('done');
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [polling, createdOrder, token]);

  const selectTab = (tb: string) => {
    setTab(tb);
    // Wash/Detail tabs also set the order's business unit; Products keep it.
    if (tb !== 'products') setBusinessUnit(tb);
  };

  const reset = () => {
    setStep('identify'); setCart([]); setBusinessUnit('AIRE'); setTab('AIRE');
    setName(''); setPhone(''); setPlate(''); setBrand(''); setModel('');
    setMembershipId(null); setSelectedPlate(null); setMemberName(null);
    setIdentifyInput(''); setIdentifyMsg('');
    setCreatedOrder(null); setQr(null); setPolling(false); setPaidAtCashier(false); setError('');
  };

  const visibleServices = tab === 'products'
    ? (menu?.products ?? [])
    : (menu?.services ?? []).filter((s) => (s.businessUnit ?? '') === tab);
  const hasProducts = (menu?.products ?? []).length > 0;

  // The kiosk is a PUBLIC page with no token, so it cannot call the
  // authenticated /business-units endpoint. It does not need to: the units this
  // tenant actually sells are exactly the distinct codes in the menu it was
  // already served, which keeps the tabs correct for any tenant without adding
  // a public endpoint that leaks their configuration (AIRIN-176).
  const kioskUnits = useMemo(() => {
    const seen: string[] = [];
    for (const s of menu?.services ?? []) {
      const code = s.businessUnit ?? '';
      if (code && !seen.includes(code)) seen.push(code);
    }
    return seen;
  }, [menu]);

  // Land on a tab that has something in it.
  useEffect(() => {
    if (kioskUnits.length === 0) return;
    if (tab === 'products' || kioskUnits.includes(tab)) return;
    setTab(kioskUnits[0]!);
    setBusinessUnit(kioskUnits[0]!);
  }, [kioskUnits, tab]);

  if (status === 'notfound') {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('cust.notFound', 'This page is not available.')}</div>;
  }
  if (status === 'loading' || loading) {
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">Loading…</div>;
  }
  if (!token) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6 text-center">
        <div className="card max-w-md">
          <h1 className="text-xl font-semibold text-text-primary">{t('kiosk.notConfigured', 'Kiosk not configured')}</h1>
          <p className="mt-2 text-text-secondary">{t('kiosk.notConfiguredMsg', 'This kiosk is missing its device token. Please ask a staff member to open it from the admin kiosk settings.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-3">
          {tenantBrand.logoUrl ? (
            <span className="inline-flex items-center justify-center w-10 h-10 bg-primary-500 rounded-xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tenantBrand.logoUrl} alt="" className="w-full h-full object-contain" />
            </span>
          ) : (
            <AirinLogo showWordmark={false} />
          )}
          <div>
            <p className="font-semibold text-text-primary">{tenantBrand.companyName || menu?.tenantName || 'Self-Service'}</p>
            <p className="text-xs text-text-muted">{t('kiosk.subtitle', 'Self-service ordering')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          {step !== 'identify' && step !== 'done' && (
            <button className="btn-ghost text-sm" onClick={reset}>{t('kiosk.startOver', 'Start over')}</button>
          )}
        </div>
      </header>

      {error && <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <main className="flex-1 p-6 max-w-3xl w-full mx-auto">
        {/* Step: identify */}
        {step === 'identify' && (
          <div className="card text-center">
            <h1 className="text-2xl font-bold text-text-primary">{t('kiosk.welcome', 'Welcome!')}</h1>
            <p className="mt-2 text-text-secondary">{t('kiosk.identifyHint', 'Scan or enter your membership QR, license plate, or phone to load your details — or continue as a guest.')}</p>
            <div className="mt-5 flex gap-2 max-w-md mx-auto">
              <input
                className="input-field text-lg flex-1"
                placeholder={t('kiosk.identifyPlaceholder', 'Plate / phone / membership')}
                value={identifyInput}
                onChange={(e) => setIdentifyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runIdentify()}
                autoFocus
              />
              <button className="btn-primary whitespace-nowrap" onClick={runIdentify} disabled={identifying || !identifyInput.trim()}>
                {identifying ? '…' : t('kiosk.findMe', 'Find me')}
              </button>
              <QrScanButton label={t('kiosk.scan', 'Scan')} onDecode={(text) => identifyWith(text)} />
            </div>
            {identifyMsg && <p className="mt-3 text-sm text-amber-700">{identifyMsg}</p>}
            <button className="btn-secondary mt-5" onClick={() => setStep('products')}>{t('kiosk.continueGuest', 'Continue as guest →')}</button>
          </div>
        )}

        {/* Step: products */}
        {step === 'products' && (
          <div>
            {memberName && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 mb-4">
                ★ {t('kiosk.welcomeBack', 'Welcome back')}, <span className="font-semibold">{memberName}</span>
              </div>
            )}
            {memberCard && cardTemplate && memberName && (
              <div className="flex flex-col items-center mb-4">
                <p className="text-xs text-text-muted mb-2">{t('kiosk.yourCard', 'Your membership card')}</p>
                <MembershipCard template={cardTemplate} data={{ name: memberName, number: memberCard.number, validUntil: memberCard.validUntil }} scale={0.5} />
              </div>
            )}
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <h2 className="section-title">{tab === 'products' ? t('kiosk.chooseProducts', 'Choose products') : t('kiosk.chooseServices', 'Choose your services')}</h2>
              <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5">
                {kioskUnits.map((code) => (
                  <button key={code} onClick={() => selectTab(code)} className={`px-4 py-1.5 text-sm font-semibold rounded-md ${tab === code ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
                    {code}
                  </button>
                ))}
                {hasProducts && (
                  <button onClick={() => selectTab('products')} className={`px-4 py-1.5 text-sm font-semibold rounded-md ${tab === 'products' ? 'bg-primary-500 text-white' : 'text-text-secondary'}`}>
                    {t('kiosk.products', 'Products')}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {visibleServices.map((s) => (
                <button
                  key={s.id}
                  onClick={() => s.available && addToCart(s)}
                  disabled={!s.available}
                  className={`card text-left transition-all ${s.available ? 'hover:border-primary-300 hover:shadow-md active:scale-[0.98]' : 'opacity-50 cursor-not-allowed'}`}
                >
                  <span className="badge bg-primary-50 text-primary-700 mb-2">{CATEGORY_LABELS[s.category] ?? s.category}</span>
                  <p className="font-medium text-text-primary text-sm">{s.name}</p>
                  <p className="text-primary-600 font-semibold mt-1">{fmt(s.price)}</p>
                  {!s.available && <p className="text-xs text-rose-600 mt-1">{t('kiosk.outOfStock', 'Out of stock')}</p>}
                </button>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="card mt-5">
                <h3 className="section-title mb-3">{t('kiosk.yourCart', 'Your cart')}</h3>
                <div className="space-y-2">
                  {cart.map((l) => (
                    <div key={l.serviceId} className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate">{l.name}</p>
                        <p className="text-xs text-text-muted">{fmt(l.price)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => changeQty(l.serviceId, -1)} className="w-8 h-8 rounded bg-surface-sunken text-lg">−</button>
                        <span className="w-6 text-center">{l.qty}</span>
                        <button onClick={() => changeQty(l.serviceId, 1)} className="w-8 h-8 rounded bg-surface-sunken text-lg">+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between border-t border-border pt-3 mt-3 text-sm">
                  <span className="text-text-secondary">{t('kiosk.subtotal', 'Subtotal')}</span><span className="font-semibold">{fmt(subtotal)}</span>
                </div>
                <p className="text-xs text-text-muted mt-1">{t('kiosk.taxNote', 'Service charge & tax calculated at checkout.')}</p>
                <button className="btn-primary w-full mt-4" onClick={() => setStep('details')} disabled={cart.length === 0}>{t('kiosk.continue', 'Continue')}</button>
              </div>
            )}
          </div>
        )}

        {/* Step: details */}
        {step === 'details' && (
          <div className="card">
            <h2 className="section-title mb-3">{t('kiosk.yourDetails', 'Your details')}</h2>
            {memberName && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800 mb-3">{t('kiosk.memberLoaded', 'Member details loaded — edit if needed.')}</div>}
            <div className="space-y-3">
              <input className="input-field" placeholder={`${t('kiosk.name', 'Name')} *`} value={name} onChange={(e) => setName(e.target.value)} />
              <input className="input-field" placeholder={`${t('kiosk.phone', 'Phone')} *`} value={phone} onChange={(e) => setPhone(e.target.value)} />
              {/* PlateInput normalises the value itself; the old `uppercase` class
                  only restyled the text while leaving spaces in the stored value. */}
              <PlateInput placeholder={t('kiosk.plate', 'License plate')} value={plate} onChange={setPlate} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input-field" placeholder={t('kiosk.brand', 'Brand')} list="k-veh-brands" value={brand} onChange={(e) => setBrand(e.target.value)} />
                <datalist id="k-veh-brands">{vehicleBrands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
                <input className="input-field" placeholder={t('kiosk.type', 'Type')} list="k-veh-types" value={model} onChange={(e) => setModel(e.target.value)} />
                <datalist id="k-veh-types">{(vehicleBrands.find((b) => b.name === brand)?.types ?? []).map((ty) => <option key={ty.id} value={ty.name} />)}</datalist>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
              <button className="btn-primary" onClick={payNow} disabled={placing || !name.trim() || !phone.trim()}>
                {placing ? '…' : t('kiosk.payNow', 'Pay now (QRIS)')}
              </button>
              <button className="btn-secondary" onClick={payAtCashier} disabled={placing || !name.trim() || !phone.trim()}>
                {placing ? '…' : t('kiosk.payCashier', 'Pay at cashier')}
              </button>
            </div>
            <button className="btn-ghost text-sm mt-3" onClick={() => setStep('products')}>{t('kiosk.back', '← Back to services')}</button>
          </div>
        )}

        {/* Step: pay (QRIS) */}
        {step === 'pay' && qr && (
          <div className="card text-center">
            <h2 className="section-title">{t('kiosk.scanToPay', 'Scan to pay')}</h2>
            <p className="text-sm text-text-secondary mt-1">{createdOrder?.orderNumber} · {createdOrder ? fmt(createdOrder.total) : ''}</p>
            <PaymentSandboxNote className="mt-3 text-left" />
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qr)}`}
              alt="QRIS payment code"
              className="mx-auto rounded-lg border border-border mt-4"
              width={240}
              height={240}
            />
            <p className="mt-4 text-sm text-text-secondary flex items-center justify-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              {t('kiosk.waiting', 'Waiting for payment…')}
            </p>
            <button className="btn-ghost text-sm mt-4" onClick={reset}>{t('kiosk.cancel', 'Cancel')}</button>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <div className="card text-center">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-3xl">✓</span></div>
            <h2 className="text-xl font-semibold text-text-primary">{paidAtCashier ? t('kiosk.orderPlaced', 'Order placed!') : t('kiosk.paymentReceived', 'Payment received!')}</h2>
            <p className="text-sm text-text-secondary mt-1">{createdOrder?.orderNumber}</p>
            <p className="mt-3 text-text-secondary">
              {paidAtCashier
                ? t('kiosk.payAtCashierMsg', 'Please proceed to the cashier to complete payment. Your car is on the queue.')
                : t('kiosk.thankYou', 'Thank you! Your car is on the queue.')}
            </p>
            <button className="btn-primary mt-5" onClick={reset}>{t('kiosk.done', 'Done')}</button>
          </div>
        )}
      </main>
    </div>
  );
}
