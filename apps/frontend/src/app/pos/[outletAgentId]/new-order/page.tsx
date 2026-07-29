'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { PosNav } from '@/components/pos/PosNav';
import { PaymentModal, type PaymentMethodDTO, type PosPaymentMethod, type PaymentSummaryLine } from '@/components/pos/PaymentModal';
import { PlateInput } from '@/components/shared/PlateInput';
import { useI18n } from '@/lib/i18n';
import { normalizePlate, maxLineDiscount, type DynamicDiscountRule } from '@aire/shared';
import type { MemberLookupResponse, MembershipDetail, PlateInfo } from '@aire/shared/interfaces/member';

interface ServiceDTO {
  id: string;
  name: string;
  category: 'car_wash' | 'product' | 'add_on';
  businessUnit: 'AIRE' | 'LEAD';
  price: number;
  isActive: boolean;
  /** Per-item manual-discount permission, set in the dashboard (AIRIN-121/122/123). */
  dynamicDiscountEnabled?: boolean;
  dynamicDiscountKind?: 'fixed' | 'percentage' | null;
  maxDiscount?: number | null;
}

interface CartLine {
  serviceId: string;
  name: string;
  price: number;
  qty: number;
  /** Cashier-entered manual discount for this line, in Rupiah (total, not per-unit).
   *  The server re-derives the cap from the item's own rule — this is UX only. */
  manualDiscount?: number;
  /** Copied from the menu item so the cart can decide whether to offer a discount
   *  field at all, without re-fetching the service. */
  discountRule?: DynamicDiscountRule;
}

interface CreatedOrder {
  id: string;
  orderNumber: string;
  total: number;
  subtotal: number;
  serviceCharge: number;
  tax: number;
  voucherDiscount: number;
  /** Set when a member's benefit was withheld (daily/lifetime quota hit) and the
   *  order was charged at normal price — surfaced so the cashier can explain it. */
  membershipQuotaWarning?: string;
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
  // Full detail of the ACTIVE membership attached to this order (only set when
  // status is genuinely active) — drives the pre-order benefit/quota preview
  // (AIRIN-126) and the plate autofill/picker below (AIRIN-116/118).
  const [memberDetail, setMemberDetail] = useState<MembershipDetail | null>(null);
  // Every plate registered to that membership — when there's more than one, the
  // cashier gets a picker instead of a silent single guess (AIRIN-116).
  const [memberPlateOptions, setMemberPlateOptions] = useState<PlateInfo[]>([]);
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
  /**
   * Voucher feedback line. `tone` drives the colour: a rejected code (not found,
   * inactive, expired, fully redeemed) has to look different from a successful
   * apply — both used to render in the same neutral grey, so a cashier could read
   * a rejection as an acceptance and hand over a free wash (AIRIN-109).
   */
  const [voucherMsg, setVoucherMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [checkingVoucher, setCheckingVoucher] = useState(false);
  // Orange badge: code is real but doesn't apply to this cart (wrong outlet/brand/
  // service, or min-order not met) — carries the server's stated reason.
  const [voucherWarning, setVoucherWarning] = useState<{ code: string; reason: string } | null>(null);

  // Promotions are no longer auto-applied — the cashier previews eligible promos
  // for the current cart and explicitly ticks the ones to apply.
  const [promoOptions, setPromoOptions] = useState<PromoOption[]>([]);
  const [selectedPromoIds, setSelectedPromoIds] = useState<string[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(false);

  // payment state
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [payMethod, setPayMethod] = useState<PosPaymentMethod>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  // Trace/slip or transfer reference — required for EDC / Credit Card / Transfer.
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paying, setPaying] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [receipt, setReceipt] = useState<{ orderNumber: string; total: number; change: number; membershipQuotaWarning?: string } | null>(null);
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

  // Select one of the member's registered plates as the order's vehicle,
  // autofilling brand/model from that plate's own record (AIRIN-116/118).
  const choosePlate = (p: PlateInfo) => {
    const norm = normalizePlate(p.plate).normalized;
    setPlate(norm);
    setSelectedPlate(norm);
    setBrand(p.brand ?? '');
    setModel(p.model ?? '');
  };

  // Apply a resolved member to the order panel. Member pricing attaches ONLY for a
  // genuinely active membership; non-active ones still show the advisory soft-pop.
  const applyMember = (m: MemberLookupResponse, plateUsed?: string) => {
    if (!m?.customer) return;
    setName(m.customer.name);
    setPhone(m.customer.phone);
    // memberships arrive most-actionable first; prefer the active one for pricing.
    const best = m.memberships?.find((x) => x.status === 'active') ?? m.memberships?.[0];
    setMemberDetail(best?.status === 'active' ? best : null);
    const plates = best?.plates ?? [];
    setMemberPlateOptions(plates);
    if (plateUsed) {
      // Searched by plate — look up that plate's OWN brand/model instead of
      // leaving them blank (AIRIN-118: previously only name/phone were set).
      const norm = normalizePlate(plateUsed).normalized;
      const match = plates.find((p) => normalizePlate(p.plate).normalized === norm);
      setSelectedPlate(norm);
      if (match) { setBrand(match.brand ?? ''); setModel(match.model ?? ''); }
    } else if (plates.length > 0) {
      // Searched by phone/member-number — no plate context at all, so nothing
      // used to get autofilled (AIRIN-116). Default to the first/primary plate;
      // the picker below (rendered when there's more than one) lets the cashier
      // switch.
      choosePlate(plates[0]!);
    }
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
      api.get<MemberLookupResponse>(`/members/lookup?plate=${encodeURIComponent(q.plate)}`)
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
      const m = await api.get<MemberLookupResponse>(`/members/lookup?${key}=${encodeURIComponent(v)}`);
      // Canonicalise the plate the cashier typed before it becomes the order's
      // plate: uppercasing alone left the spaces in, so "B 8882 CST" and
      // "B8882CST" produced two different stored values (AIRIN-117).
      const canonicalPlate = key === 'plate' ? normalizePlate(v).normalized : undefined;
      if (m?.customer) { applyMember(m, canonicalPlate); if (canonicalPlate) setPlate(canonicalPlate); }
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
      return [...prev, {
        serviceId: s.id,
        name: s.name,
        price: s.price,
        qty: 1,
        // Carried onto the line so the cart knows whether this item may be
        // discounted at all, and by how much (AIRIN-121).
        discountRule: {
          enabled: s.dynamicDiscountEnabled ?? false,
          kind: s.dynamicDiscountKind ?? null,
          maxDiscount: s.maxDiscount ?? null,
        },
      }];
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

  // Per-line discount ceiling from the item's OWN dashboard rule. 0 means the
  // item was never enabled for cashier discounts, so no field is offered at all
  // (AIRIN-121). The server re-derives this from the DB regardless.
  const lineDiscountCap = (l: CartLine) => Math.floor(maxLineDiscount(l.discountRule, l.price, l.qty));
  const canDiscount = (l: CartLine) => lineDiscountCap(l) > 0;

  const changeDiscount = (serviceId: string, value: string) => {
    const raw = Math.max(0, Number(value) || 0);
    setCart((prev) => prev.map((l) => {
      if (l.serviceId !== serviceId) return l;
      // Clamp to this line's own ceiling so the cashier can't type past it and
      // then be surprised when the server charges more than the screen showed.
      return { ...l, manualDiscount: Math.min(raw, lineDiscountCap(l)) };
    }));
  };

  const subtotal = cart.reduce((sum, l) => sum + Math.max(0, l.price * l.qty - (l.manualDiscount ?? 0)), 0);
  const totalManualDiscount = cart.reduce((sum, l) => sum + (l.manualDiscount ?? 0), 0);
  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

  // Pre-order membership eligibility preview (AIRIN-126). Mirrors the server's
  // own gate in order.service.ts#getMembershipBenefits: the daily limit is
  // PER MEMBERSHIP (summed across every registered plate), not per plate, and
  // a lifetime cap of 0/undefined means unlimited. This is advisory only — the
  // server re-derives everything at order-creation time; it exists so the
  // cashier learns the outcome BEFORE placing the order instead of after.
  const memberDailyUsageTotal = memberDetail
    ? Object.values(memberDetail.dailyUsageToday).reduce((sum, n) => sum + n, 0)
    : 0;
  const memberQuotaExhausted = !!memberDetail && memberDetail.maxUses > 0 && memberDetail.usesCount >= memberDetail.maxUses;
  const memberDailyLimitReached = !!memberDetail && !memberQuotaExhausted && memberDailyUsageTotal >= memberDetail.dailyLimit;
  const memberBenefitBlocked = memberQuotaExhausted || memberDailyLimitReached;

  /** The badge this member's plan grants a cart line, or null if none applies. */
  const memberLineBenefit = (l: CartLine): string | null => {
    if (!memberDetail || memberBenefitBlocked) return null;
    if (memberDetail.freeServices.includes(l.serviceId)) return 'GRATIS';
    const ds = memberDetail.discountedServices.find((d) => d.serviceId === l.serviceId);
    if (!ds) return null;
    if (typeof ds.fixedPrice === 'number' && ds.fixedPrice < l.price) return t('pos.new.memberBenefitFixedBadge', 'HARGA MEMBER');
    if (typeof ds.discountPct === 'number' && ds.discountPct > 0) return `${t('pos.new.memberBenefitPctBadgePrefix', 'MEMBER -')}${ds.discountPct}%`;
    return null;
  };

  const applyVoucher = async () => {
    const code = voucherInput.trim().toUpperCase();
    if (!code) return;
    if (voucherCodes.includes(code)) {
      setVoucherMsg({ tone: 'warn', text: t('pos.new.codeAlreadyAdded', 'Code already added') });
      return;
    }
    setCheckingVoucher(true);
    setVoucherMsg(null);
    setVoucherWarning(null);
    try {
      const res = await api.post<{ status: string; message: string; discountAmount?: number; reason?: string }>(
        '/vouchers/validate',
        { code, serviceIdsInCart: cart.map((l) => l.serviceId), orderSubtotal: subtotal },
      );
      if (res.status === 'valid_applicable') {
        setVoucherCodes((prev) => [...prev, code]);
        setVoucherInput('');
        setVoucherMsg({ tone: 'ok', text: `${t('pos.new.applied', 'Applied:')} −${fmt(res.discountAmount ?? 0)}` });
      } else if (res.status === 'valid_not_applicable') {
        // Real code, but not applicable to this cart (wrong outlet/brand/service or
        // min-order not met) — orange badge with the server's reason, not an error.
        setVoucherWarning({ code, reason: res.reason || res.message || t('pos.new.voucherCannotApply', 'Voucher cannot be applied') });
      } else {
        // Not found / inactive / expired / fully redeemed — a hard rejection.
        setVoucherMsg({ tone: 'error', text: res.message || t('pos.new.voucherCannotApply', 'Voucher cannot be applied') });
      }
    } catch (e) {
      setVoucherMsg({ tone: 'error', text: e instanceof Error ? e.message : t('pos.new.validationFailed', 'Validation failed') });
    } finally {
      setCheckingVoucher(false);
    }
  };

  const removeVoucher = (code: string) => {
    setVoucherCodes((prev) => prev.filter((c) => c !== code));
    setVoucherMsg(null);
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
        // Plate is canonicalised here too, so a plate typed straight into the
        // field (never routed through member search) is stored in the same shape
        // as one that was — otherwise the two paths disagree (AIRIN-117).
        customer: { name: name.trim(), phone: phone.trim(), licensePlate: normalizePlate(plate).normalized || undefined, brand: brand.trim() || undefined, model: model.trim() || undefined },
        items: cart.map((l) => ({ serviceId: l.serviceId, quantity: l.qty, manualDiscount: l.manualDiscount || undefined })),
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
    // EDC / Credit Card / Transfer require a reference number before settling.
    if ((payMethod === 'edc' || payMethod === 'cc' || payMethod === 'transfer') && !referenceNumber.trim()) {
      setError(t('pos.new.referenceRequired', 'Enter the reference/trace number to settle this payment.'));
      return;
    }
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
        referenceNumber: (payMethod === 'edc' || payMethod === 'cc' || payMethod === 'transfer') ? referenceNumber.trim() : undefined,
      });
      const change = payMethod === 'cash' ? Math.max(0, Number(amountReceived) - order.total) : 0;
      finishSale(order.orderNumber, order.total, change, order.membershipQuotaWarning);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.new.paymentFailed', 'Payment failed'));
    } finally {
      setPaying(false);
    }
  };

  const finishSale = (orderNumber: string, total: number, change: number, membershipQuotaWarning?: string) => {
    setReceipt({ orderNumber, total, change, membershipQuotaWarning });
    setCart([]);
    setName(''); setPhone(''); setPlate(''); setBrand(''); setModel('');
    setVoucherCodes([]); setVoucherInput(''); setVoucherMsg(null); setVoucherWarning(null);
    setPromoOptions([]); setSelectedPromoIds([]);
    setOrder(null); setQr(null); setPolling(false); setPaying(false); setSelectedPmId(null);
    setQueueEntryId(null); setMembershipId(null); setSelectedPlate(null); setMemberBanner(null);
    setMemberExpiry(null); setMemberAlert(null); setFindInput('');
    setMemberDetail(null); setMemberPlateOptions([]);
    setReferenceNumber(''); setPayMethod('cash');
  };

  // Poll order status while waiting for QRIS gateway confirmation
  useEffect(() => {
    if (!polling || !order) return;
    const id = setInterval(async () => {
      try {
        const o = await api.get<{ status: string; orderNumber: string; total: number }>(`/orders/${order.id}`);
        if (o.status === 'paid') {
          clearInterval(id);
          finishSale(o.orderNumber, o.total, 0, order.membershipQuotaWarning);
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
            {/* Multiple registered vehicles on this member — pick which one this
                order is for; defaults to the first/primary plate (AIRIN-116). */}
            {memberPlateOptions.length > 1 && (
              <div className="rounded-lg bg-sky-50 border border-sky-200 p-2">
                <label className="block text-[11px] font-medium text-sky-800 mb-1">
                  {t('pos.new.multiplePlatesHint', 'This member has multiple vehicles — pick one:')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {memberPlateOptions.map((p) => {
                    const norm = normalizePlate(p.plate).normalized;
                    const active = selectedPlate === norm;
                    return (
                      <button
                        key={p.plate}
                        type="button"
                        onClick={() => choosePlate(p)}
                        className={`badge border ${active ? 'bg-primary-500 text-white border-primary-500' : 'bg-white text-text-secondary border-border hover:border-primary-300'}`}
                      >
                        {p.plate}{p.brand ? ` · ${p.brand}${p.model ? ` ${p.model}` : ''}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <input className="input-field" placeholder={t('pos.new.customerName', 'Customer name *')} value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input-field" placeholder={t('pos.new.phone', 'Phone (e.g. 08123…) *')} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <PlateInput
              placeholder={t('pos.new.licensePlate', 'License plate (optional)')}
              value={plate}
              onChange={setPlate}
            />
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
              <div key={l.serviceId} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
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
                {/* The discount field appears ONLY for items the dashboard has
                    enabled for cashier discounts, capped by that item's own
                    maximum. It used to show on every line under a single
                    tenant-wide percentage (AIRIN-121). */}
                {canDiscount(l) && (
                  <div className="flex items-center gap-1.5 pl-0.5">
                    <label htmlFor={`disc-${l.serviceId}`} className="text-[11px] text-text-muted">{t('pos.new.discount', 'Disc')}</label>
                    <input
                      id={`disc-${l.serviceId}`}
                      type="number"
                      min={0}
                      max={lineDiscountCap(l)}
                      className="input-field !py-1 !px-2 text-xs w-24"
                      placeholder="Rp 0"
                      value={l.manualDiscount || ''}
                      onChange={(e) => changeDiscount(l.serviceId, e.target.value)}
                      aria-label={`${t('pos.new.discount', 'Discount')} — ${l.name}`}
                      data-testid={`line-discount-${l.serviceId}`}
                    />
                    <span className="text-[11px] text-text-muted">
                      {t('pos.new.discountMaxHint', 'max')} {fmt(lineDiscountCap(l))}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('pos.new.voucherCode', 'Voucher Code')}</label>
            <div className="flex gap-2">
              <input
                className="input-field flex-1 uppercase"
                placeholder={t('pos.new.enterCode', 'Enter code')}
                value={voucherInput}
                onChange={(e) => { setVoucherInput(e.target.value.toUpperCase()); setVoucherWarning(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyVoucher(); } }}
              />
              <button onClick={applyVoucher} disabled={checkingVoucher || !voucherInput.trim()} className="btn-secondary">
                {checkingVoucher ? '…' : t('pos.new.apply', 'Apply')}
              </button>
            </div>
            {voucherMsg && (
              <p
                role={voucherMsg.tone === 'error' ? 'alert' : 'status'}
                data-testid="voucher-msg"
                data-tone={voucherMsg.tone}
                className={`mt-1 rounded-md px-2 py-1 text-xs font-medium ${
                  voucherMsg.tone === 'ok' ? 'bg-green-50 text-green-700'
                    : voucherMsg.tone === 'warn' ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                }`}
              >
                {voucherMsg.tone === 'ok' ? '✓ ' : voucherMsg.tone === 'warn' ? '⚠ ' : '✕ '}{voucherMsg.text}
              </p>
            )}
            {voucherWarning && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                <span className="badge bg-orange-50 text-orange-700 border border-orange-200 shrink-0">{voucherWarning.code}</span>
                <span className="text-orange-700">{voucherWarning.reason}</span>
              </div>
            )}
            {voucherCodes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {voucherCodes.map((c) => (
                  <span key={c} className="badge bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                    {c}
                    <button onClick={() => removeVoucher(c)} className="text-blue-400 hover:text-blue-700">✕</button>
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

          {/* Member benefit / quota preview — surfaced BEFORE Place Order so the
              cashier (and customer) know the outcome before an order even
              exists, rather than discovering a withheld benefit only after
              POST /orders already created it (AIRIN-126). */}
          {membershipId && memberDetail && (
            <div className="border-t border-border pt-3 mt-3">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('pos.new.memberBenefitTitle', 'Member Benefit')}</label>
              {cart.length === 0 ? (
                <p className="text-xs text-text-muted">{t('pos.new.memberBenefitAddItems', 'Add items to preview the member benefit.')}</p>
              ) : memberBenefitBlocked ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800" data-testid="member-benefit-blocked">
                  ⚠️ {memberQuotaExhausted
                    ? t('pos.new.memberQuotaExhausted', 'Membership quota exhausted — this order will be charged full price.')
                    : t('pos.new.memberDailyLimitReached', 'This membership already had a wash today — daily limit reached (applies to every car on this membership). Full price will be charged.')}
                </div>
              ) : (
                <div className="space-y-1">
                  {cart.map((l) => {
                    const badge = memberLineBenefit(l);
                    if (!badge) return null;
                    return (
                      <div key={l.serviceId} className="flex items-center justify-between text-xs" data-testid={`member-benefit-${l.serviceId}`}>
                        <span className="text-text-secondary truncate">{l.name}</span>
                        <span className={`badge ${badge === 'GRATIS' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>{badge}</span>
                      </div>
                    );
                  })}
                  {cart.every((l) => !memberLineBenefit(l)) && (
                    <p className="text-xs text-text-muted">{t('pos.new.memberBenefitNone', 'No member benefit applies to the items in this cart.')}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-border pt-3 mt-3">
            <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.subtotal', 'Subtotal')}</span><span className="font-medium">{fmt(subtotal)}</span></div>
            {totalManualDiscount > 0 && (
              <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.manualDiscount', 'Manual discount')}</span><span className="font-medium text-green-600">−{fmt(totalManualDiscount)}</span></div>
            )}
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

      {/* Payment modal (AIRIN-125: shared with sell-pack) */}
      {order && (
        <PaymentModal
          orderLabel={`${t('pos.new.payment', 'Payment')} — ${order.orderNumber}`}
          total={order.total}
          summaryLines={[
            { key: 'subtotal', label: t('pos.new.subtotal', 'Subtotal'), amount: order.subtotal },
            { key: 'serviceCharge', label: t('pos.new.serviceCharge', 'Service charge'), amount: order.serviceCharge },
            { key: 'tax', label: t('pos.new.tax', 'Tax'), amount: order.tax },
            ...(order.voucherDiscount > 0 ? [{ key: 'voucher', label: t('pos.new.voucher', 'Voucher'), amount: order.voucherDiscount, discount: true }] : []),
            { key: 'total', label: t('pos.new.total', 'Total'), amount: order.total, emphasis: true },
          ] satisfies PaymentSummaryLine[]}
          membershipQuotaWarning={order.membershipQuotaWarning}
          payMethods={payMethods}
          selectedPmId={selectedPmId}
          payMethod={payMethod}
          onSelectMethod={(pmId, method) => { setSelectedPmId(pmId); setPayMethod(method); }}
          businessUnit={businessUnit}
          amountReceived={amountReceived}
          onAmountReceivedChange={setAmountReceived}
          referenceNumber={referenceNumber}
          onReferenceNumberChange={setReferenceNumber}
          qr={qr}
          polling={polling}
          paying={paying}
          onConfirm={confirmPayment}
          onCancel={() => { setOrder(null); setQr(null); setPolling(false); setReferenceNumber(''); }}
        />
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
            {receipt.membershipQuotaWarning && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 text-left">
                ⚠️ {receipt.membershipQuotaWarning}
              </div>
            )}
            <button className="btn-primary w-full mt-5" onClick={() => setReceipt(null)}>{t('pos.new.newOrder', 'New Order')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
