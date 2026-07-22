'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { PosNav } from '@/components/pos/PosNav';
import { PaymentSandboxNote } from '@/components/shared/PaymentSandboxNote';
import { useI18n } from '@/lib/i18n';

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

interface MemberLookupResp {
  customer: { id: string; name: string; phone: string };
  memberships: { id: string; planName: string; status: string; endDate: string }[];
}

/** A promo the cashier can opt into for the current cart (previewed server-side —
 * never auto-applied; only ids the cashier checks are sent to createOrder). */
interface PromoOption {
  id: string;
  name: string;
  rewardType: string;
  rewardValue: number;
  amount: number;
  memberOnly: boolean;
  stackable: boolean;
  minPurchase: number;
  eligible: boolean;
  reason?: string;
}

interface QueuePickEntry {
  id: string; plate: string | null; brand: string | null; model: string | null;
  customerName: string | null; customerPhone: string | null; businessUnit: string | null;
  status: string; orderId: string | null;
}

/** Picker for "Order from Queue" — lists waiting cars that don't yet have an order. */
function QueuePickerModal({ outletId, onClose, onPick }: {
  outletId: string; onClose: () => void; onPick: (q: QueuePickEntry) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<QueuePickEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<QueuePickEntry[]>(`/vehicle-queue?outletId=${outletId}`)
      .then((r) => setRows(r.filter((q) => q.status !== 'done' && q.status !== 'cancelled' && !q.orderId)))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [outletId]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-1">{t('pos.new.orderFromQueue', 'Order from Queue')}</h3>
        <p className="text-xs text-text-muted mb-3">{t('pos.new.pickWaitingCar', 'Pick a waiting car to ring up. Its details prefill the order.')}</p>
        {loading ? <p className="text-sm text-text-muted">{t('pos.new.loading', 'Loading…')}</p> : rows.length === 0 ? (
          <p className="text-sm text-text-muted">{t('pos.new.noWaitingCars', 'No waiting cars without an order.')}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((q) => (
              <button key={q.id} onClick={() => onPick(q)} className="w-full text-left card hover:border-primary-300 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary">{q.plate ?? '—'} <span className={`badge ml-1 ${q.businessUnit === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{q.businessUnit ?? 'AIRE'}</span></p>
                  <p className="text-xs text-text-muted">{[q.brand, q.model].filter(Boolean).join(' ') || t('pos.new.vehicleDetailsNotSet', 'Vehicle details not set')}{q.customerName ? ` · ${q.customerName}` : ''}</p>
                </div>
                <span className="badge bg-primary-50 text-primary-700 shrink-0">{t('pos.new.select', 'Select')}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end mt-4"><button className="btn-secondary" onClick={onClose}>{t('pos.new.cancel', 'Cancel')}</button></div>
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  car_wash: 'Car Wash',
  add_on: 'Add-on',
  product: 'Product',
};

export default function NewOrderPage() {
  const { t } = useI18n();
  const params = useParams();
  const categoryLabel = (c: string) =>
    c === 'car_wash' ? t('pos.new.catCarWash', CATEGORY_LABELS.car_wash)
      : c === 'add_on' ? t('pos.new.catAddOn', CATEGORY_LABELS.add_on)
        : t('pos.new.catProduct', CATEGORY_LABELS.product);
  const [services, setServices] = useState<ServiceDTO[]>([]);
  // One shared cart. AIRE (wash) and LEAD (detail) items mix into a single
  // receipt/payment; switching the tab only changes which catalog is shown.
  const [cart, setCart] = useState<CartLine[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [businessUnit, setBusinessUnit] = useState<'AIRE' | 'LEAD'>('AIRE');
  const [salesperson, setSalesperson] = useState('');
  const [salespersonEmployeeId, setSalespersonEmployeeId] = useState('');
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [barcodeCfg, setBarcodeCfg] = useState<{ enabled: boolean; scanAddsToCart: boolean }>({ enabled: false, scanAddsToCart: false });
  const [scanCode, setScanCode] = useState('');
  const [scanMsg, setScanMsg] = useState('');
  // "Order from queue" prefill + resolved member (auto-applies member pricing).
  const [queueEntryId, setQueueEntryId] = useState<string | null>(null);
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [selectedPlate, setSelectedPlate] = useState<string | null>(null);
  const [memberBanner, setMemberBanner] = useState<string | null>(null);
  const [memberExpiry, setMemberExpiry] = useState<string | null>(null);
  // Soft-pop shown when a detected member needs attention (expiring/grace/revoked/suspended/cancelled).
  const [memberAlert, setMemberAlert] = useState<{ level: 'info' | 'warn' | 'urgent'; title: string; body: string; canRenew: boolean } | null>(null);
  const [showQueuePicker, setShowQueuePicker] = useState(false);
  const [findInput, setFindInput] = useState('');
  const [finding, setFinding] = useState(false);
  const [vehicleBrands, setVehicleBrands] = useState<{ id: string; name: string; types: { id: string; name: string }[] }[]>([]);
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

  // Promotions are no longer auto-applied — the cashier previews eligible promos
  // for the current cart and explicitly ticks the ones to apply.
  const [promoOptions, setPromoOptions] = useState<PromoOption[]>([]);
  const [selectedPromoIds, setSelectedPromoIds] = useState<string[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(false);

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
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  // Branch is authoritative from the operator's OPEN shift (chosen at shift open),
  // so every sale is booked into a shift + branch and finance never diverges.
  const [openShift, setOpenShift] = useState<{ id: string; outletId: string } | null>(null);
  const [shiftChecked, setShiftChecked] = useState(false);

  // Load the service catalog + payment methods for a branch (pricing is
  // branch-specific). Called on mount and whenever the operator switches branch.
  const loadCatalog = useCallback((outletId: string | null) => {
    const q = outletId ? `?outletId=${outletId}` : '';
    // Services and products are separate APIs but share one POS menu — load both.
    Promise.all([
      api.get<ServiceDTO[]>(`/services${q}`),
      api.get<ServiceDTO[]>(`/products${q}`).catch(() => [] as ServiceDTO[]),
    ])
      .then(([svcs, prods]) => setServices([...svcs, ...prods].filter((s) => s.isActive)))
      .catch((e) => setError(e instanceof Error ? e.message : t('pos.new.failedLoadServices', 'Failed to load services')))
      .finally(() => setLoading(false));
    const pmUrl = outletId ? `/payment-methods?active=true&outletId=${outletId}` : '/payment-methods?active=true';
    api.get<PaymentMethodDTO[]>(pmUrl).then(setPayMethods).catch(() => { /* default buttons */ });
    // Employees for the salesperson picker (drives commission crediting). Falls
    // back to the free-text field if the cashier lacks HR read access.
    api.get<{ id: string; name: string }[]>('/hr/employees').then(setEmployees).catch(() => setEmployees([]));
    // Barcode scan-to-cart config (feature is off by default; only show the scanner when enabled).
    api.get<{ enabled: boolean; scanAddsToCart: boolean }>('/barcode/config')
      .then((c) => setBarcodeCfg({ enabled: !!c.enabled, scanAddsToCart: c.scanAddsToCart !== false }))
      .catch(() => setBarcodeCfg({ enabled: false, scanAddsToCart: false }));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    // The operating branch is the branch of the operator's OPEN shift (branch is
    // chosen once, at shift open). No open shift → the POS is gated (can't ring up).
    Promise.all([
      api.get<{ branches: { id: string; name: string }[] }>('/hr/my/branch-context').catch(() => null),
      api.get<{ id?: string; outletId?: string } | null>('/shifts/current').catch(() => null),
    ]).then(([ctx, shift]) => {
      setBranches(ctx?.branches ?? []);
      setShiftChecked(true);
      if (shift && shift.id && shift.outletId) {
        setOpenShift({ id: shift.id, outletId: shift.outletId });
        setOperatingOutletId(shift.outletId);
        loadCatalog(shift.outletId);
      } else {
        setLoading(false);
      }
    });
  }, [loadCatalog]);

  // Membership status → cashier soft-pop. Covers expiring-soon, grace, revoked,
  // suspended and cancelled; returns null for a healthy active membership.
  const computeMemberAlert = (
    status: string,
    endDate?: string,
  ): { level: 'info' | 'warn' | 'urgent'; title: string; body: string; canRenew: boolean } | null => {
    if (status === 'revoked' || status === 'expired') {
      return { level: 'urgent', title: t('pos.new.mAlertRevokedTitle', 'Membership expired'), body: t('pos.new.mAlertRevokedBody', 'Past the grace period — sell a new membership from Sell Pack (or renew, which starts a fresh term).'), canRenew: true };
    }
    if (status === 'suspended') {
      return { level: 'warn', title: t('pos.new.mAlertSuspendedTitle', 'Membership suspended'), body: t('pos.new.mAlertSuspendedBody', 'On hold — an admin must reactivate it before member pricing applies.'), canRenew: false };
    }
    if (status === 'cancelled') {
      return { level: 'warn', title: t('pos.new.mAlertCancelledTitle', 'Membership cancelled'), body: t('pos.new.mAlertCancelledBody', 'This membership was cancelled — sell a new one from Sell Pack.'), canRenew: true };
    }
    if (status === 'grace') {
      return { level: 'warn', title: t('pos.new.mAlertGraceTitle', 'Expired — grace period'), body: t('pos.new.mAlertGraceBody', 'Still renewable within the grace period. Renew now from Sell Pack.'), canRenew: true };
    }
    if (status === 'active' && endDate) {
      const end = new Date(endDate); end.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((end.getTime() - today.getTime()) / 86400000);
      if (days <= 14) {
        return { level: 'info', title: t('pos.new.mAlertExpiringTitle', 'Membership expiring soon'), body: `${t('pos.new.mAlertExpiringBody', 'Expires in')} ${days} ${t('pos.new.mAlertExpiringDays', 'day(s) — offer a renewal.')}`, canRenew: true };
      }
    }
    return null;
  };

  // Apply a resolved member to the order panel. Member pricing attaches ONLY for a
  // genuinely active membership; non-active ones still show the advisory soft-pop.
  const applyMember = (m: MemberLookupResp, plateUsed?: string) => {
    if (!m?.customer) return;
    setName(m.customer.name);
    setPhone(m.customer.phone);
    if (plateUsed) setSelectedPlate(plateUsed);
    // memberships arrive most-actionable first; prefer the active one for pricing.
    const best = m.memberships?.find((x) => x.status === 'active') ?? m.memberships?.[0];
    if (best) {
      setMemberBanner(best.planName);
      setMembershipId(best.status === 'active' ? best.id : null);
      const alert = computeMemberAlert(best.status, best.endDate);
      setMemberAlert(alert);
      setMemberExpiry(alert ? alert.body : null);
    }
  };

  // Hydrate the panel from a queued car; resolve its plate to a member if any.
  const applyQueueEntry = (q: { id: string; plate?: string | null; brand?: string | null; model?: string | null; customerName?: string | null; customerPhone?: string | null; businessUnit?: string | null }) => {
    setQueueEntryId(q.id);
    if (q.plate) setPlate(q.plate);
    if (q.brand) setBrand(q.brand);
    if (q.model) setModel(q.model);
    if (q.customerName) setName(q.customerName);
    if (q.customerPhone) setPhone(q.customerPhone);
    if (q.businessUnit === 'AIRE' || q.businessUnit === 'LEAD') setBusinessUnit(q.businessUnit);
    if (q.plate) {
      api.get<MemberLookupResp>(`/members/lookup?plate=${encodeURIComponent(q.plate)}`)
        .then((m) => applyMember(m, q.plate ?? undefined))
        .catch(() => { /* non-member — manual entry */ });
    }
  };

  // Manual "Find member" on a fresh order — by plate or phone.
  const findMember = async () => {
    const v = findInput.trim();
    if (!v) return;
    setFinding(true); setError('');
    // A 12-char alphanumeric value = membership number (scanned or typed);
    // digits-only = phone; otherwise a plate.
    const isNumber = /^[0-9A-Za-z]{12}$/.test(v);
    const isPhone = !isNumber && /\d/.test(v) && !/[a-z]/i.test(v);
    const key = isNumber ? 'number' : isPhone ? 'phone' : 'plate';
    try {
      const m = await api.get<MemberLookupResp>(`/members/lookup?${key}=${encodeURIComponent(v)}`);
      if (m?.customer) { applyMember(m, key === 'plate' ? v.toUpperCase() : undefined); if (key === 'plate') setPlate(v.toUpperCase()); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.new.noMemberFound', 'No member found'));
    } finally { setFinding(false); }
  };

  // Vehicle brand/type catalog for the brand → type dropdowns.
  useEffect(() => {
    api.get<{ id: string; name: string; types: { id: string; name: string }[] }[]>('/vehicle-brands')
      .then(setVehicleBrands)
      .catch(() => { /* catalog optional — falls back to free text */ });
  }, []);

  // "Order from queue" via query params (from the Queue tab's Proses Bayar link).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const qId = sp.get('queueId');
    if (!qId) return;
    applyQueueEntry({
      id: qId, plate: sp.get('plate'), brand: sp.get('brand'), model: sp.get('model'),
      customerName: sp.get('name'), customerPhone: sp.get('phone'), businessUnit: sp.get('bu'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToCart = (s: ServiceDTO) => {
    setCart((prev) => {
      const found = prev.find((l) => l.serviceId === s.id);
      if (found) return prev.map((l) => l.serviceId === s.id ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, { serviceId: s.id, name: s.name, price: s.price, qty: 1 }];
    });
  };

  // Scan-to-cart: resolve a scanned/typed barcode to a product and add it. Works
  // with keyboard-wedge scanners (they type the code + Enter); manual entry works too.
  const handleScan = async (code: string) => {
    const c = code.trim();
    if (!c) return;
    setScanMsg('');
    try {
      const qs = operatingOutletId ? `?outletId=${operatingOutletId}` : '';
      const p = await api.get<ServiceDTO>(`/products/by-barcode/${encodeURIComponent(c)}${qs}`);
      addToCart(p);
      setScanCode('');
    } catch {
      setScanMsg(t('pos.new.scanNotFound', 'No product matches that barcode.'));
    }
  };

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
      setVoucherMsg(t('pos.new.codeAlreadyAdded', 'Code already added'));
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
        setVoucherMsg(`${t('pos.new.applied', 'Applied:')} −${fmt(res.discountAmount ?? 0)}`);
      } else {
        setVoucherMsg(res.message || t('pos.new.voucherCannotApply', 'Voucher cannot be applied'));
      }
    } catch (e) {
      setVoucherMsg(e instanceof Error ? e.message : t('pos.new.validationFailed', 'Validation failed'));
    } finally {
      setCheckingVoucher(false);
    }
  };

  const removeVoucher = (code: string) => {
    setVoucherCodes((prev) => prev.filter((c) => c !== code));
    setVoucherMsg('');
  };

  // Preview eligible promos for the current cart. Re-runs whenever the cart or the
  // attached member changes; nothing is auto-applied — the cashier must tick a promo.
  useEffect(() => {
    if (cart.length === 0) {
      setPromoOptions([]);
      setSelectedPromoIds([]);
      return;
    }
    let cancelled = false;
    setLoadingPromos(true);
    api
      .post<PromoOption[]>('/orders/promotions/preview', {
        items: cart.map((l) => ({ serviceId: l.serviceId, quantity: l.qty })),
        membershipId: membershipId ?? undefined,
        operatingOutletId: operatingOutletId ?? undefined,
      })
      .then((res) => {
        if (cancelled) return;
        setPromoOptions(res);
        // Drop selections that no longer exist or became ineligible (cart/member changed).
        setSelectedPromoIds((prev) => prev.filter((id) => res.some((p) => p.id === id && p.eligible)));
      })
      .catch(() => { if (!cancelled) setPromoOptions([]); })
      .finally(() => { if (!cancelled) setLoadingPromos(false); });
    return () => { cancelled = true; };
  }, [cart, membershipId, operatingOutletId]);

  const togglePromo = (id: string) => {
    const promo = promoOptions.find((p) => p.id === id);
    if (!promo || !promo.eligible) return;
    setSelectedPromoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Naive sum of what the cashier selected — the server is authoritative on stacking
  // (a non-stackable pick applies alone); the UI hints that below the promo list.
  const promoDiscount = promoOptions
    .filter((p) => selectedPromoIds.includes(p.id))
    .reduce((sum, p) => sum + p.amount, 0);
  const hasNonStackableSelected = selectedPromoIds.length > 1 &&
    promoOptions.some((p) => selectedPromoIds.includes(p.id) && !p.stackable);

  const placeOrder = async () => {
    setError('');
    if (!openShift) {
      setError(t('pos.new.openShiftBeforeOrders', 'Open a shift before taking orders (Shift tab).'));
      return;
    }
    if (!name.trim() || !phone.trim() || cart.length === 0) {
      setError(t('pos.new.enterCustomerService', 'Enter customer name, phone, and add at least one service.'));
      return;
    }
    setPlacing(true);
    try {
      const created = await api.post<CreatedOrder>('/orders', {
        customer: { name: name.trim(), phone: phone.trim(), licensePlate: plate.trim() || undefined, brand: brand.trim() || undefined, model: model.trim() || undefined },
        items: cart.map((l) => ({ serviceId: l.serviceId, quantity: l.qty })),
        businessUnit,
        salespersonName: salesperson.trim() || undefined,
        salespersonEmployeeId: salespersonEmployeeId || undefined,
        voucherCodes: voucherCodes.length ? voucherCodes : undefined,
        promotionIds: selectedPromoIds.length ? selectedPromoIds : undefined,
        operatingOutletId: operatingOutletId ?? undefined,
        membershipId: membershipId ?? undefined,
        selectedPlate: selectedPlate ?? undefined,
        queueEntryId: queueEntryId ?? undefined,
      });
      setOrder(created);
      setAmountReceived(String(created.total));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.new.failedPlaceOrder', 'Failed to place order'));
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
      setError(e instanceof Error ? e.message : t('pos.new.paymentFailed', 'Payment failed'));
    } finally {
      setPaying(false);
    }
  };

  const finishSale = (orderNumber: string, total: number, change: number) => {
    setReceipt({ orderNumber, total, change });
    setCart([]);
    setName(''); setPhone(''); setPlate(''); setBrand(''); setModel('');
    setVoucherCodes([]); setVoucherInput(''); setVoucherMsg('');
    setPromoOptions([]); setSelectedPromoIds([]);
    setOrder(null); setQr(null); setPolling(false); setPaying(false); setSelectedPmId(null);
    setQueueEntryId(null); setMembershipId(null); setSelectedPlate(null); setMemberBanner(null);
    setMemberExpiry(null); setMemberAlert(null); setFindInput('');
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
    return <div className="min-h-screen bg-surface flex items-center justify-center text-text-muted">{t('pos.new.loadingPos', 'Loading POS…')}</div>;
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <PosNav
        agent={params.outletAgentId as string}
        active="new-order"
        title={t('pos.new.pointOfSale', 'Point of Sale')}
      />

      {error && <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Order from Queue — pick a waiting car to ring up (prefills this order). */}
      {openShift && (
        <div className="mx-5 mt-4">
          <button onClick={() => setShowQueuePicker(true)} className="btn-secondary text-sm inline-flex items-center gap-1">↩ {t('pos.new.orderFromQueue', 'Order from Queue')}</button>
        </div>
      )}

      {/* Operating branch is fixed by the open shift (chosen at shift open). */}
      {shiftChecked && !openShift ? (
        <div className="mx-5 mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          {t('pos.new.noOpenShift', 'No open shift. Open a shift from the')} <span className="font-semibold">{t('pos.new.shift', 'Shift')}</span> {t('pos.new.tabToTakeOrders', 'tab to take orders — every sale is booked into your shift & branch.')}
        </div>
      ) : openShift ? (
        <div className="mx-5 mt-4 flex items-center gap-2 text-sm text-text-muted">
          <span>{t('pos.new.operatingBranch', 'Operating branch:')}</span>
          <span className="badge bg-surface-sunken text-text-secondary">{branches.find((b) => b.id === openShift.outletId)?.name ?? t('pos.new.yourShiftBranch', 'Your shift branch')}</span>
          <span className="text-xs">{t('pos.new.fromOpenShift', '(from your open shift)')}</span>
        </div>
      ) : null}

      <div className="flex-1 grid lg:grid-cols-3 gap-5 p-5 min-h-0">
        {/* Service grid */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">{t('pos.new.services', 'Services')}</h2>
            {/* Business unit switch — AIRE car wash vs LEAD detailing */}
            <div className="inline-flex rounded-md border border-border bg-surface-raised p-0.5" role="group" aria-label={t('pos.new.businessUnit', 'Business unit')}>
              {(['AIRE', 'LEAD'] as const).map((bu) => (
                <button
                  key={bu}
                  onClick={() => setBusinessUnit(bu)}
                  className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                    businessUnit === bu ? 'bg-primary-500 text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {bu === 'AIRE' ? `AIRE · ${t('pos.new.wash', 'Wash')}` : `LEAD · ${t('pos.new.detail', 'Detail')}`}
                </button>
              ))}
            </div>
          </div>
          {barcodeCfg.enabled && barcodeCfg.scanAddsToCart && (
            <div className="mb-3">
              <input
                className="input-field"
                placeholder={t('pos.new.scanBarcode', 'Scan or type a barcode, then Enter…')}
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(scanCode); } }}
                aria-label={t('pos.new.scanBarcode', 'Scan barcode')}
              />
              {scanMsg && <p className="mt-1 text-xs text-rose-600">{scanMsg}</p>}
            </div>
          )}
          {visibleServices.length === 0 ? (
            <div className="card text-sm text-text-muted">{t('pos.new.noActive', 'No active')} {businessUnit} {t('pos.new.servicesAddDashboard', 'services. Add some in the dashboard.')}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {visibleServices.map((s) => (
                <button
                  key={s.id}
                  onClick={() => addToCart(s)}
                  className="card text-left hover:border-primary-300 hover:shadow-md transition-all active:scale-[0.98]"
                >
                  <span className="badge bg-primary-50 text-primary-700 mb-2">{categoryLabel(s.category)}</span>
                  <p className="font-medium text-text-primary text-sm">{s.name}</p>
                  <p className="text-primary-600 font-semibold mt-1">{fmt(s.price)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <h2 className="section-title mb-3">{t('pos.new.order', 'Order')}</h2>

          <div className="space-y-2 mb-4">
            {/* Find member by plate or phone (member pricing + expiry note). */}
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder={t('pos.new.findMemberPlaceholder', 'Find member (plate, phone, or member #)')}
                value={findInput}
                onChange={(e) => setFindInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findMember(); } }}
              />
              <button type="button" className="btn-secondary" onClick={findMember} disabled={finding || !findInput.trim()}>
                {finding ? '…' : t('pos.new.find', 'Find')}
              </button>
            </div>
            {memberBanner && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800">
                ★ {t('pos.new.member', 'Member')} · <span className="font-semibold">{memberBanner}</span> {t('pos.new.detailsAutofilled', '— details auto-filled, member pricing applied.')}
              </div>
            )}
            {memberExpiry && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">⏳ {memberExpiry}</div>
            )}
            {queueEntryId && !memberBanner && (
              <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-xs text-sky-800">
                {t('pos.new.fromQueue', 'From queue — enter name & phone to complete payment.')}
              </div>
            )}
            <input className="input-field" placeholder={t('pos.new.customerName', 'Customer name *')} value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input-field" placeholder={t('pos.new.phone', 'Phone (e.g. 08123…) *')} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="input-field" placeholder={t('pos.new.licensePlate', 'License plate (optional)')} value={plate} onChange={(e) => setPlate(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" placeholder={t('pos.new.vehicleBrand', 'Vehicle brand')} list="veh-brands" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <datalist id="veh-brands">{vehicleBrands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
              <input className="input-field" placeholder={t('pos.new.vehicleType', 'Vehicle type')} list="veh-types" value={model} onChange={(e) => setModel(e.target.value)} />
              <datalist id="veh-types">{(vehicleBrands.find((b) => b.name === brand)?.types ?? []).map((t) => <option key={t.id} value={t.name} />)}</datalist>
            </div>
            {employees.length > 0 ? (
              <select
                className="input-field"
                aria-label={t('pos.new.salesperson', 'Salesperson (optional)')}
                value={salespersonEmployeeId}
                onChange={(e) => {
                  setSalespersonEmployeeId(e.target.value);
                  setSalesperson(employees.find((emp) => emp.id === e.target.value)?.name ?? '');
                }}
              >
                <option value="">{t('pos.new.salesperson', 'Salesperson (optional)')}</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            ) : (
              <input className="input-field" placeholder={t('pos.new.salesperson', 'Salesperson (optional)')} value={salesperson} onChange={(e) => setSalesperson(e.target.value)} />
            )}
          </div>

          <div className="flex-1 overflow-auto border-t border-border pt-3 space-y-2 min-h-[120px]">
            {cart.length === 0 ? (
              <p className="text-sm text-text-muted italic">{t('pos.new.tapServices', 'Tap services to add them to the order.')}</p>
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
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('pos.new.voucherCode', 'Voucher Code')}</label>
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder={t('pos.new.enterCode', 'Enter code')}
                value={voucherInput}
                onChange={(e) => setVoucherInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyVoucher(); } }}
              />
              <button onClick={applyVoucher} disabled={checkingVoucher || !voucherInput.trim()} className="btn-secondary">
                {checkingVoucher ? '…' : t('pos.new.apply', 'Apply')}
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
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('pos.new.promoSectionTitle', 'Promo')}</label>
            {cart.length === 0 ? (
              <p className="text-xs text-text-muted">{t('pos.new.promoAddItemsFirst', 'Add items to see available promos.')}</p>
            ) : loadingPromos ? (
              <p className="text-xs text-text-muted">{t('pos.new.promoLoading', 'Checking eligible promos…')}</p>
            ) : promoOptions.length === 0 ? (
              <p className="text-xs text-text-muted">{t('pos.new.promoNone', 'No promotions available for this cart.')}</p>
            ) : (
              <div className="space-y-1.5">
                {promoOptions.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-start gap-2 text-sm p-2 rounded-lg border ${
                      p.eligible ? 'border-border cursor-pointer hover:border-primary-300' : 'border-border opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!p.eligible}
                      checked={selectedPromoIds.includes(p.id)}
                      onChange={() => togglePromo(p.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-text-primary">
                        {p.name}
                        {!p.stackable && <span className="ml-1.5 badge bg-amber-50 text-amber-700 text-[10px] align-middle">{t('pos.new.promoNonStackable', 'Not combinable')}</span>}
                        {p.memberOnly && <span className="ml-1.5 badge bg-emerald-50 text-emerald-700 text-[10px] align-middle">{t('pos.new.promoMemberOnly', 'Member only')}</span>}
                      </span>
                      {p.eligible ? (
                        <span className="block text-xs text-green-600">−{fmt(p.amount)}</span>
                      ) : (
                        <span className="block text-xs text-rose-500">{p.reason || t('pos.new.promoIneligible', 'Not eligible')}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {hasNonStackableSelected && (
              <p className="mt-1.5 text-xs text-amber-600">
                {t('pos.new.promoStackNote', 'Some selected promos cannot be combined — the system will apply only one non-stackable promo at checkout.')}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.subtotal', 'Subtotal')}</span><span className="font-medium">{fmt(subtotal)}</span></div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.promoSectionTitle', 'Promo')}</span><span className="font-medium text-green-600">−{fmt(promoDiscount)}</span></div>
            )}
            <div className="flex justify-between text-sm font-semibold mb-1"><span>{t('pos.new.estimatedTotal', 'Estimated total')}</span><span className="text-primary-600">{fmt(Math.max(0, subtotal - promoDiscount))}</span></div>
            <p className="text-xs text-text-muted mb-3">{t('pos.new.serviceChargeTaxNote', 'Service charge & tax calculated at order time.')}</p>
            <button onClick={placeOrder} disabled={placing || cart.length === 0 || !openShift} className="btn-primary w-full">
              {placing ? t('pos.new.placing', 'Placing…') : !openShift ? t('pos.new.openShiftFirst', 'Open a shift first') : t('pos.new.placeOrder', 'Place Order')}
            </button>
          </div>
        </div>
      </div>

      {/* Payment modal */}
      {order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md">
            <h3 className="section-title">{t('pos.new.payment', 'Payment')} — {order.orderNumber}</h3>
            <PaymentSandboxNote className="mt-3" />
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-secondary">{t('pos.new.subtotal', 'Subtotal')}</span><span>{fmt(order.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">{t('pos.new.serviceCharge', 'Service charge')}</span><span>{fmt(order.serviceCharge)}</span></div>
              <div className="flex justify-between"><span className="text-text-secondary">{t('pos.new.tax', 'Tax')}</span><span>{fmt(order.tax)}</span></div>
              {order.voucherDiscount > 0 && <div className="flex justify-between"><span className="text-text-secondary">{t('pos.new.voucher', 'Voucher')}</span><span className="text-green-600">−{fmt(order.voucherDiscount)}</span></div>}
              <div className="flex justify-between text-base font-semibold border-t border-border pt-2 mt-2"><span>{t('pos.new.total', 'Total')}</span><span className="text-primary-600">{fmt(order.total)}</span></div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1.5">{t('pos.new.paymentMethod', 'Payment Method')}</label>
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
                <select aria-label={t('pos.new.paymentMethod', 'Payment method')} className="input-field" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} disabled={polling}>
                  <option value="cash">{t('pos.new.cash', 'Cash')}</option>
                  <option value="qris_dynamic">{t('pos.new.qrisScan', 'QRIS (scan to pay)')}</option>
                  <option value="edc">{t('pos.new.edcDebit', 'EDC / Debit')}</option>
                  <option value="cc">{t('pos.new.creditCard', 'Credit Card')}</option>
                  <option value="transfer">{t('pos.new.bankTransfer', 'Bank Transfer')}</option>
                </select>
              )}
              {payMethod !== 'cash' && (
                <p className="mt-1.5 text-xs text-text-muted">{t('pos.new.settlesTo', 'Settles to the')} <span className="font-medium text-text-primary">{payMethods.find((m) => m.id === selectedPmId)?.businessUnit ?? businessUnit}</span> {t('pos.new.account', 'account.')}</p>
              )}
            </div>

            {payMethod === 'cash' && !qr && (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1.5">{t('pos.new.amountReceived', 'Amount Received')}</label>
                <input aria-label={t('pos.new.amountReceived', 'Amount received')} type="number" className="input-field" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                <p className="mt-1 text-sm text-text-secondary">{t('pos.new.change', 'Change:')} <span className="font-medium text-text-primary">{fmt(Math.max(0, Number(amountReceived || 0) - order.total))}</span></p>
              </div>
            )}

            {qr && (
              <div className="mt-4 text-center">
                <p className="text-sm text-text-secondary mb-2">{t('pos.new.scanQris', 'Scan with any QRIS app to pay')}</p>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`}
                  alt={t('pos.new.qrisAlt', 'QRIS payment code')}
                  className="mx-auto rounded-lg border border-border"
                  width={220}
                  height={220}
                />
                <p className="mt-3 text-sm text-text-secondary flex items-center justify-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {t('pos.new.waitingConfirmation', 'Waiting for payment confirmation…')}
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-secondary" onClick={() => { setOrder(null); setQr(null); setPolling(false); }} disabled={paying && !qr}>
                {qr ? t('pos.new.close', 'Close') : t('pos.new.cancel', 'Cancel')}
              </button>
              {!qr && (
                <button className="btn-primary" onClick={confirmPayment} disabled={paying}>
                  {paying ? t('pos.new.processing', 'Processing…') : payMethod === 'qris_dynamic' ? t('pos.new.generateQr', 'Generate QR') : t('pos.new.confirmPayment', 'Confirm Payment')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showQueuePicker && openShift && (
        <QueuePickerModal
          outletId={openShift.outletId}
          onClose={() => setShowQueuePicker(false)}
          onPick={(q) => { applyQueueEntry(q); setShowQueuePicker(false); }}
        />
      )}

      {/* Membership status soft-pop — auto-shown when a detected member needs attention. */}
      {memberAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMemberAlert(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-3 text-2xl ${
              memberAlert.level === 'urgent' ? 'bg-rose-100' : memberAlert.level === 'warn' ? 'bg-amber-100' : 'bg-sky-100'
            }`}>{memberAlert.level === 'info' ? '⏳' : '⚠️'}</div>
            <h3 className="text-lg font-semibold text-text-primary">{memberAlert.title}</h3>
            <p className="text-xs text-text-muted mt-0.5">{name}{memberBanner ? ` · ${memberBanner}` : ''}</p>
            <p className="text-sm text-text-secondary mt-3">{memberAlert.body}</p>
            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-secondary" onClick={() => setMemberAlert(null)}>{t('pos.new.mAlertContinue', 'Continue order')}</button>
              {memberAlert.canRenew && (
                <a href={`/pos/${params.outletAgentId as string}/sell-pack`} className="btn-primary">{t('pos.new.mAlertRenew', 'Go to Sell Pack')}</a>
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
            <h3 className="text-lg font-semibold text-text-primary">{t('pos.new.paymentSuccessful', 'Payment Successful')}</h3>
            <p className="text-sm text-text-secondary mt-1">{t('pos.new.order', 'Order')} {receipt.orderNumber}</p>
            <div className="mt-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-text-secondary">{t('pos.new.totalPaid', 'Total Paid')}</span><span className="font-medium">{fmt(receipt.total)}</span></div>
              {receipt.change > 0 && <div className="flex justify-between"><span className="text-text-secondary">{t('pos.new.changeLabel', 'Change')}</span><span className="font-medium">{fmt(receipt.change)}</span></div>}
            </div>
            <button className="btn-primary w-full mt-5" onClick={() => setReceipt(null)}>{t('pos.new.newOrder', 'New Order')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
