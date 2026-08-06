'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { PosNav } from '@/components/pos/PosNav';
import { PaymentModal, type PaymentMethodDTO, type PosPaymentMethod, type PaymentSummaryLine } from '@/components/pos/PaymentModal';
import { PlateInput } from '@/components/shared/PlateInput';
import { LprSuggestions } from '@/components/pos/LprSuggestions';
import { PackCatalog, type MembershipPlanDTO, type VoucherTemplateDTO } from '@/components/pos/PackCatalog';
import { PlateRegistrationModal, VoucherCodesModal, type IssuedPack } from '@/components/pos/PackFollowUpModals';
import { MemberManagementPanel } from '@/components/pos/MemberManagementPanel';
import { useI18n } from '@/lib/i18n';
import { filterOfferableDetections, upsertDetection } from '@/lib/lprSuggestions';
import { normalizePlate, maxLineDiscount, applyMembershipPricing, LPR_DETECTED_EVENT, type DynamicDiscountRule, type MembershipBenefit, type PlateDetection, type PlateDetectedPayload } from '@aire/shared';
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
  /** The percentage the cashier actually typed, when this item's dashboard rule is
   *  kind='percentage'. `manualDiscount` stays the derived Rupiah amount (the only
   *  thing the API accepts); this is kept so the field redisplays what was typed
   *  and can be re-derived when the quantity changes (AIRIN-122/123). */
  manualDiscountPct?: number;
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
  /** Which membership PRICED this order (an existing member's), if any. */
  membershipId?: string | null;
  /** Membership created by a plan SOLD on this order. Payment activates it
   *  server-side; this id is only needed to offer extra vehicles afterwards. */
  soldMembershipId?: string | null;
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
  // LPR (license-plate recognition) suggestions for the operating outlet — a
  // tappable chip only. Nothing here writes the plate/customer fields on its
  // own; only picking a chip does (AIRIN-25, POS half).
  const [lprDetections, setLprDetections] = useState<PlateDetection[]>([]);
  // Bumped on a timer purely to force the TTL filter to re-run and drop chips
  // that aged out, even when no new detection arrives to trigger a re-render.
  const [lprTick, setLprTick] = useState(0);
  const [lprBusyId, setLprBusyId] = useState<string | null>(null);
  const [showQueuePicker, setShowQueuePicker] = useState(false);
  // ── Packs sold from this same screen (the retired /sell-pack page) ──────────
  // A selected pack rides along on THIS order: one payment for "cuci + langganan".
  const [catalogTab, setCatalogTab] = useState<'services' | 'packs'>('services');
  const [plans, setPlans] = useState<MembershipPlanDTO[]>([]);
  const [voucherTemplates, setVoucherTemplates] = useState<VoucherTemplateDTO[]>([]);
  const [sellPlan, setSellPlan] = useState<MembershipPlanDTO | null>(null);
  const [sellVoucherTpl, setSellVoucherTpl] = useState<VoucherTemplateDTO | null>(null);
  // Post-payment steps: a paid plan still needs its plates before it activates,
  // and a paid voucher pack still needs its codes generated.
  const [activation, setActivation] = useState<{ membershipId: string; planName: string; maxPlates: number; plate?: string; brand?: string; model?: string } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedPack | null>(null);
  const [showIssuedModal, setShowIssuedModal] = useState(false);
  // Renewal + plate/cancel management for an existing member, also folded in
  // from sell-pack. A renewal is its own fee order (it extends a membership
  // rather than putting a plan line on this cart), so it reuses the same
  // PaymentModal through `order` with this flag saying what to do on success.
  const [pendingRenewalId, setPendingRenewalId] = useState<string | null>(null);
  const [showMemberPanel, setShowMemberPanel] = useState(false);
  const [renewPlanId, setRenewPlanId] = useState('');
  const [memberLookup, setMemberLookup] = useState<MemberLookupResponse | null>(null);
  const [findInput, setFindInput] = useState('');
  const [finding, setFinding] = useState(false);
  // Member-search feedback lives NEXT TO the search box, not in the page-top
  // error banner: cashiers never saw it up there and it stayed on screen until
  // something else cleared it (Samuel 2026-08-03). It clears itself when the
  // cashier edits the query or after a few seconds.
  const [findMsg, setFindMsg] = useState('');
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
    // Sellable packs. Neither is branch-scoped, so they load once regardless of
    // which branch the shift is on. Failures leave the Packs tab empty rather
    // than blocking the wash catalog.
    api.get<MembershipPlanDTO[]>('/membership-plans').then(setPlans).catch(() => setPlans([]));
    api.get<VoucherTemplateDTO[]>('/voucher-packs/catalog').then(setVoucherTemplates).catch(() => setVoucherTemplates([]));
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

  // Fetch recent LPR detections for the operating outlet and subscribe to the
  // live feed. Both are best-effort: a branch with no ANPR camera, or a
  // backend that doesn't have this endpoint/gateway wired yet, must not
  // surface as an error — the feature stays invisible unless a real detection
  // exists (AIRIN-25).
  useEffect(() => {
    if (!operatingOutletId) return;
    let cancelled = false;
    api.get<PlateDetection[]>(`/lpr/detections?outletId=${operatingOutletId}`)
      .then((rows) => { if (!cancelled) setLprDetections(rows); })
      .catch(() => { /* no camera at this branch, or endpoint not live yet */ });

    // Same socket.io server the realtime gateway already exposes — the
    // `join:outlet` room convention is shared with the order/queue/payment
    // pushes it already does. Connecting with no URL keeps this same-origin,
    // so it rides the existing `/socket.io` rewrite (next.config.mjs in dev,
    // nginx in front of it in prod) instead of opening a second connection to
    // a hardcoded backend host.
    const socket: Socket = io({ transports: ['websocket', 'polling'] });
    socket.emit('join:outlet', { outletId: operatingOutletId });
    const onDetected = (payload: PlateDetectedPayload) => {
      setLprDetections((prev) => upsertDetection(prev, payload.detection));
    };
    socket.on(LPR_DETECTED_EVENT, onDetected);

    return () => {
      cancelled = true;
      socket.off(LPR_DETECTED_EVENT, onDetected);
      socket.disconnect();
    };
  }, [operatingOutletId]);

  // Re-filter periodically so a chip disappears once it ages past the TTL
  // even without a new detection arriving to trigger a re-render.
  useEffect(() => {
    const id = setInterval(() => setLprTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- lprTick exists solely to force this to re-run on a timer
  const offerableLprDetections = useMemo(() => filterOfferableDetections(lprDetections), [lprDetections, lprTick]);

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

  /**
   * Wipe every trace of a previously resolved member. Without this, a lookup
   * that finds nobody (or a non-member) left the PREVIOUS customer's membership
   * banner, plan, plate picker and — worst of all — `membershipId` attached, so
   * the next order could be priced against a member who was never in front of
   * the cashier (AIRIN-144). Name/phone are deliberately left alone: the cashier
   * may be mid-typing them for a walk-in.
   */
  const clearMemberState = () => {
    setMemberLookup(null);
    setMemberDetail(null);
    setMemberBanner(null);
    setMembershipId(null);
    setMemberPlateOptions([]);
    setSelectedPlate(null);
    setMemberAlert(null);
    setMemberExpiry(null);
    setPendingRenewalId(null);
  };

  // Apply a resolved member to the order panel. Member pricing attaches ONLY for a
  // genuinely active membership; non-active ones still show the advisory soft-pop.
  const applyMember = (m: MemberLookupResponse, plateUsed?: string) => {
    if (!m?.customer) return;
    // Kept whole for the member-management panel (plates / cancel), which needs
    // the full lookup, not just the membership picked for pricing.
    setMemberLookup(m);
    setName(m.customer.name);
    setPhone(m.customer.phone);
    // memberships arrive most-actionable first; prefer the active one for pricing.
    const best = m.memberships?.find((x) => x.status === 'active') ?? m.memberships?.[0];
    setMemberDetail(best?.status === 'active' ? best : null);
    // Membership plates drive pricing, so they win. A returning NON-member has
    // none, and the backend then reports the cars from their past orders on
    // customer.plates — use those so the cashier stops retyping a vehicle the
    // shop has already served (AIRIN-147).
    const plates = best?.plates?.length ? best.plates : (m.customer.plates ?? []);
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

  // Tapping an LPR chip is the cashier's explicit confirmation — the only
  // thing that ever writes the plate field from a detection. It reuses the
  // exact same plate-lookup + applyMember path as the manual "Find member"
  // box (rather than trusting PlateDetectionMatch's summary fields directly),
  // so membership pricing/eligibility logic isn't duplicated and stays
  // correct even if the membership changed since the camera matched it
  // (AIRIN-25).
  const pickDetection = async (d: PlateDetection) => {
    const norm = normalizePlate(d.plateNormalized).normalized;
    // A different car — whoever was resolved before does not own it (AIRIN-144).
    clearMemberState();
    setPlate(norm);
    setLprBusyId(d.id);
    if (d.match) {
      try {
        const m = await api.get<MemberLookupResponse>(`/members/lookup?plate=${encodeURIComponent(norm)}`);
        applyMember(m, norm);
      } catch { /* matched at capture time but the lookup fails now — plate stays filled, order proceeds as non-member */ }
    }
    // Drop it from the offered list immediately (used, not to be offered
    // again) and best-effort tell the server so no other till on this branch
    // keeps offering the same detection.
    setLprDetections((prev) => prev.filter((x) => x.id !== d.id));
    api.post(`/lpr/detections/${d.id}/confirm`, { plate: norm }).catch(() => { /* best-effort */ });
    setLprBusyId(null);
  };

  // Hydrate the panel from a queued car; resolve its plate to a member if any.
  const applyQueueEntry = (q: { id: string; plate?: string | null; brand?: string | null; model?: string | null; customerName?: string | null; customerPhone?: string | null; businessUnit?: string | null }) => {
    // Pulling in a queued car replaces whoever the panel was showing (AIRIN-144).
    clearMemberState();
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
    setFinding(true); setError(''); setFindMsg('');
    // Drop the previous result BEFORE the request, so a slow/failed lookup can
    // never leave the last customer's membership attached to this order.
    clearMemberState();
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
      if (m?.customer) {
        applyMember(m, canonicalPlate);
        if (canonicalPlate) setPlate(canonicalPlate);
        // Say so explicitly when the match is a known customer WITHOUT a
        // membership: their details and vehicle are now filled in, and silence
        // there reads as "nothing happened" (AIRIN-147).
        if (!m.memberships?.length) {
          setFindMsg(t('pos.new.customerNoMembership', 'Customer found — no active membership. Details filled in.'));
        }
      } else {
        setFindMsg(t('pos.new.noMemberFound', 'No member found'));
      }
    } catch (e) {
      setFindMsg(e instanceof Error ? e.message : t('pos.new.noMemberFound', 'No member found'));
    } finally { setFinding(false); }
  };

  /**
   * Renew the member found above. A renewal EXTENDS an existing membership
   * rather than selling a plan line, so the backend mints its own fee order —
   * it reuses this page's PaymentModal, and `pendingRenewalId` tells the
   * post-payment step to apply the renewal instead of activating a new plan.
   * (Ported from the retired Sell Pack page.)
   */
  const startRenewal = async (membershipId: string) => {
    const planId = renewPlanId || plans[0]?.id;
    if (!planId) { setError(t('pos.sellpack.selectPlanRenew', 'Select a plan to renew on.')); return; }
    setPlacing(true); setError('');
    try {
      const r = await api.post<{ order: { id: string; orderNumber: string; total: number } }>(
        `/memberships/${membershipId}/renew`, { planId },
      );
      setPendingRenewalId(membershipId);
      setOrder({
        id: r.order.id, orderNumber: r.order.orderNumber, total: r.order.total,
        subtotal: r.order.total, serviceCharge: 0, tax: 0, voucherDiscount: 0,
      });
      setAmountReceived(String(r.order.total));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.sellpack.failedStartRenewal', 'Failed to start renewal'));
    } finally {
      setPlacing(false);
    }
  };

  // The search note is transient — it disappears on its own so the cashier is
  // never left staring at a stale "not found" from two customers ago.
  useEffect(() => {
    if (!findMsg) return;
    const id = setTimeout(() => setFindMsg(''), 6000);
    return () => clearTimeout(id);
  }, [findMsg]);

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
        if (qty <= 0) return [];
        const next = { ...l, qty };
        // A percentage discount is a proportion of the LINE, so changing the
        // quantity must re-derive the Rupiah amount; leaving the old figure would
        // silently turn "10%" into some other fraction (AIRIN-122/123).
        if (next.manualDiscountPct != null) {
          next.manualDiscount = pctToRupiah(next, next.manualDiscountPct);
        } else if (next.manualDiscount != null) {
          // A fixed-Rupiah discount must still never exceed the (new) line total.
          next.manualDiscount = Math.min(next.manualDiscount, lineDiscountCap(next));
        }
        return [next];
      }),
    );
  };

  // Per-line discount ceiling from the item's OWN dashboard rule. 0 means the
  // item was never enabled for cashier discounts, so no field is offered at all
  // (AIRIN-121). The server re-derives this from the DB regardless.
  const lineDiscountCap = (l: CartLine) => Math.floor(maxLineDiscount(l.discountRule, l.price, l.qty));
  const canDiscount = (l: CartLine) => lineDiscountCap(l) > 0;

  /**
   * Whether this item's dashboard rule is expressed as a percentage. The POS used
   * to take Rupiah for every item regardless, using `kind` only to compute the
   * ceiling — so an item configured "max 10%" presented a Rupiah box and the
   * cashier had to do the arithmetic (AIRIN-122/123).
   */
  const isPctRule = (l: CartLine) => l.discountRule?.enabled === true && l.discountRule.kind === 'percentage';
  /** Percentage ceiling from the rule, never above 100. */
  const linePctCap = (l: CartLine) => Math.min(l.discountRule?.maxDiscount ?? 0, 100);
  /** Rupiah equivalent of a percentage of the whole line, rounded to the rupiah. */
  const pctToRupiah = (l: CartLine, pct: number) =>
    Math.min(Math.round((pct / 100) * l.price * l.qty), lineDiscountCap(l));

  const changeDiscount = (serviceId: string, value: string) => {
    const raw = Math.max(0, Number(value) || 0);
    setCart((prev) => prev.map((l) => {
      if (l.serviceId !== serviceId) return l;
      if (isPctRule(l)) {
        // The cashier typed a PERCENTAGE. Clamp to the configured percentage cap,
        // then derive the Rupiah amount the API actually takes.
        const pct = Math.min(raw, linePctCap(l));
        return { ...l, manualDiscountPct: pct, manualDiscount: pctToRupiah(l, pct) };
      }
      // Clamp to this line's own ceiling so the cashier can't type past it and
      // then be surprised when the server charges more than the screen showed.
      return { ...l, manualDiscountPct: undefined, manualDiscount: Math.min(raw, lineDiscountCap(l)) };
    }));
  };

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

  /**
   * The member benefit expressed as money, per line — so Subtotal and Estimated
   * total show what will actually be charged.
   *
   * The badges above already told the cashier a line was GRATIS or member-priced,
   * but the totals ignored them entirely and still showed the full list price, so
   * the screen disagreed with the receipt (AIRIN-150).
   *
   * This reuses the SERVER's own `applyMembershipPricing` rather than
   * re-implementing the arithmetic, so a preview can't drift from the charge, and
   * it mirrors two server rules exactly:
   *   - a voucher SUPPRESSES member pricing entirely (Golden Rule, handbook §6.2 —
   *     the voucher wins and quota is preserved), and
   *   - `discountPct` is a 0-1 FRACTION in the shared helper while the lookup
   *     reports whole percents, hence the ÷100.
   */
  const memberPricing = useMemo(() => {
    const voucherWins = voucherCodes.length > 0;
    if (!memberDetail || memberBenefitBlocked || voucherWins || cart.length === 0) {
      return { discountByService: {} as Record<string, number>, total: 0 };
    }
    const benefits: MembershipBenefit[] = [{
      membershipId: memberDetail.id,
      planName: memberDetail.planName,
      freeServiceIds: memberDetail.freeServices,
      discountedServices: memberDetail.discountedServices.map((d) => ({
        serviceId: d.serviceId,
        discountPct: typeof d.discountPct === 'number' ? d.discountPct / 100 : undefined,
        fixedPrice: d.fixedPrice,
      })),
    }];
    const { items } = applyMembershipPricing(
      cart.map((l) => ({
        serviceId: l.serviceId,
        serviceName: l.name,
        quantity: l.qty,
        unitPrice: l.price,
        discount: 0,
        isMainService: false,
      })),
      benefits,
    );
    const discountByService: Record<string, number> = {};
    let total = 0;
    for (const it of items) {
      if (it.discount > 0) {
        discountByService[it.serviceId] = it.discount;
        total += it.discount;
      }
    }
    return { discountByService, total };
  }, [memberDetail, memberBenefitBlocked, voucherCodes, cart]);

  /**
   * What a line really costs: the member benefit wins over the cashier's manual
   * discount, because the server refuses to stack them (a member-priced line is
   * skipped by the manual-discount pass).
   */
  const lineNet = (l: CartLine) => {
    const memberOff = memberPricing.discountByService[l.serviceId];
    const gross = l.price * l.qty;
    if (memberOff != null) return Math.max(0, gross - memberOff);
    return Math.max(0, gross - (l.manualDiscount ?? 0));
  };

  const subtotal = cart.reduce((sum, l) => sum + lineNet(l), 0);
  // Only discounts the server will actually honour are worth showing as a line.
  const totalManualDiscount = cart.reduce(
    (sum, l) => sum + (memberPricing.discountByService[l.serviceId] != null ? 0 : (l.manualDiscount ?? 0)),
    0,
  );

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
  // Cart-side mirror of the server's upsell rule (order.service.ts step 6c):
  // selling a plan on this order frees the car_wash lines — add-ons and products
  // stay payable — and the pack fee itself rides on top, untaxed.
  // Uses lineNet, not the gross price: if a line is ALREADY free through a member
  // benefit, subtracting its list price again would drive the estimate below what
  // the server charges.
  const washSubtotal = cart.reduce(
    (sum, l) => (services.find((s) => s.id === l.serviceId)?.category === 'car_wash'
      ? sum + lineNet(l)
      : sum),
    0,
  );
  const packSubtotal = (sellPlan?.price ?? 0) + (sellVoucherTpl?.salePrice ?? 0);
  const estimatedTotal = Math.max(0, subtotal - (sellPlan ? washSubtotal : 0) - promoDiscount) + packSubtotal;

  const hasNonStackableSelected = selectedPromoIds.length > 1 &&
    promoOptions.some((p) => selectedPromoIds.includes(p.id) && !p.stackable);

  const placeOrder = async () => {
    setError('');
    if (!openShift) {
      setError(t('pos.new.openShiftBeforeOrders', 'Open a shift before taking orders (Shift tab).'));
      return;
    }
    // A pack on its own is a complete sale (that is all the old Sell Pack page
    // ever did), so an empty cart is only an error when nothing is being sold.
    const sellsPack = Boolean(sellPlan || sellVoucherTpl);
    if (!name.trim() || !phone.trim() || (cart.length === 0 && !sellsPack)) {
      setError(t('pos.new.enterCustomerService', 'Enter customer name, phone, and add at least one service.'));
      return;
    }
    // Plate is mandatory: every order is a vehicle, and reports/queue/LPR/member
    // matching all key off it (Samuel 2026-08-03).
    if (!normalizePlate(plate).normalized) {
      setError(t('pos.new.plateRequired', 'Enter the license plate.'));
      return;
    }
    setPlacing(true);
    try {
      const created = await api.post<CreatedOrder>('/orders', {
        // Plate is canonicalised here too, so a plate typed straight into the
        // field (never routed through member search) is stored in the same shape
        // as one that was — otherwise the two paths disagree (AIRIN-117).
        customer: { name: name.trim(), phone: phone.trim(), licensePlate: normalizePlate(plate).normalized, brand: brand.trim() || undefined, model: model.trim() || undefined },
        items: cart.map((l) => ({ serviceId: l.serviceId, quantity: l.qty, manualDiscount: l.manualDiscount || undefined })),
        businessUnit,
        salespersonName: salesperson.trim() || undefined,
        salespersonEmployeeId: salespersonEmployeeId || undefined,
        voucherCodes: voucherCodes.length ? voucherCodes : undefined,
        promotionIds: selectedPromoIds.length ? selectedPromoIds : undefined,
        operatingOutletId: operatingOutletId ?? undefined,
        membershipId: membershipId ?? undefined,
        // Distinct from membershipId above: that prices the wash for an EXISTING
        // member, this SELLS a new plan on this order (and frees the wash).
        membershipPlanId: sellPlan?.id,
        voucherPackTemplateId: sellVoucherTpl?.id,
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
      await runPostPaymentSteps(order);
      finishSale(order.orderNumber, order.total, change, order.membershipQuotaWarning);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('pos.new.paymentFailed', 'Payment failed'));
    } finally {
      setPaying(false);
    }
  };

  /**
   * What a paid order still owes its customer when it sold a pack: a renewal
   * must be applied, a new plan must be activated against its plates, and a
   * voucher pack must have its codes generated. Runs BEFORE finishSale, which
   * clears the selections these steps read.
   *
   * Each step is independent and non-fatal — the money is already taken, so a
   * failure here must surface as an error the cashier can retry, never as a
   * blocked screen.
   */
  const runPostPaymentSteps = async (paid: CreatedOrder) => {
    if (pendingRenewalId) {
      try {
        await api.post('/memberships/apply-renewal', { orderId: paid.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('pos.sellpack.failedApplyRenewal', 'Failed to apply renewal'));
      }
      return;
    }
    // Payment activates the membership server-side (MembershipActivationService),
    // with the car on this order registered as its first vehicle — so there is
    // nothing the cashier MUST do here. Offer the extra-vehicle step only when
    // the plan actually covers more than one car; on a single-plate plan the
    // membership is already complete.
    if (sellPlan && paid.soldMembershipId && sellPlan.maxPlates > 1) {
      setActivation({
        membershipId: paid.soldMembershipId,
        planName: sellPlan.name,
        maxPlates: sellPlan.maxPlates,
        plate, brand, model,
      });
    }
    if (sellVoucherTpl) {
      setIssuing(true);
      setShowIssuedModal(true);
      try {
        setIssued(await api.post<IssuedPack>('/voucher-packs/issue', { orderId: paid.id, templateId: sellVoucherTpl.id }));
      } catch (e) {
        setError(e instanceof Error ? e.message : t('pos.sellpack.failedIssueVouchers', 'Failed to issue voucher codes'));
      } finally {
        setIssuing(false);
      }
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
    setSellPlan(null); setSellVoucherTpl(null); setPendingRenewalId(null);
    setCatalogTab('services');
  };

  // Poll order status while waiting for QRIS gateway confirmation
  useEffect(() => {
    if (!polling || !order) return;
    const id = setInterval(async () => {
      try {
        const o = await api.get<{ status: string; orderNumber: string; total: number }>(`/orders/${order.id}`);
        if (o.status === 'paid') {
          clearInterval(id);
          await runPostPaymentSteps(order);
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
          {/* Services vs packs. Both sell into the SAME order — there is no
              separate Sell Pack page any more (Samuel 2026-07-30). */}
          <div className="inline-flex rounded-lg bg-surface-sunken p-1 mb-3">
            {(['services', 'packs'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCatalogTab(tab)}
                data-testid={`catalog-tab-${tab}`}
                className={`px-4 py-1.5 text-sm rounded-md ${catalogTab === tab ? 'bg-surface-raised shadow-sm font-medium text-text-primary' : 'text-text-secondary'}`}
              >
                {tab === 'services' ? t('pos.new.services', 'Services') : t('pos.new.packsTab', 'Membership & Vouchers')}
              </button>
            ))}
          </div>

          {catalogTab === 'packs' ? (
            <PackCatalog
              plans={plans}
              templates={voucherTemplates}
              selectedPlanId={sellPlan?.id ?? null}
              selectedTemplateId={sellVoucherTpl?.id ?? null}
              onPickPlan={setSellPlan}
              onPickTemplate={setSellVoucherTpl}
            />
          ) : (
          <>
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
          </>
          )}
        </div>

        {/* Cart */}
        <div className="card flex flex-col">
          <h2 className="section-title mb-3">{t('pos.new.order', 'Order')}</h2>

          <div className="space-y-2 mb-4">
            {/* Camera-detected plates for this branch — tappable suggestion
                only; renders nothing when there's nothing to offer (AIRIN-25). */}
            <LprSuggestions detections={offerableLprDetections} onPick={pickDetection} busyId={lprBusyId} />
            {/* Find member by plate or phone (member pricing + expiry note). */}
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder={t('pos.new.findMemberPlaceholder', 'Find member (plate, phone, or member #)')}
                value={findInput}
                onChange={(e) => { setFindInput(e.target.value); if (findMsg) setFindMsg(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findMember(); } }}
              />
              <button type="button" className="btn-secondary" onClick={findMember} disabled={finding || !findInput.trim()}>
                {finding ? '…' : t('pos.new.find', 'Find')}
              </button>
            </div>
            {/* Search result note, right under the box it belongs to. */}
            {findMsg && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
                <span className="flex-1">{findMsg}</span>
                <button
                  type="button"
                  aria-label={t('common.dismiss', 'Dismiss')}
                  className="text-amber-700 hover:text-amber-900 leading-none"
                  onClick={() => setFindMsg('')}
                >
                  ×
                </button>
              </div>
            )}
            {memberBanner && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800">
                ★ {t('pos.new.member', 'Member')} · <span className="font-semibold">{memberBanner}</span> {t('pos.new.detailsAutofilled', '— details auto-filled, member pricing applied.')}
              </div>
            )}
            {memberExpiry && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">⏳ {memberExpiry}</div>
            )}
            {/* Renew / manage the found member without leaving this screen —
                both used to live on the Sell Pack page. */}
            {memberLookup && (memberLookup.memberships?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-sunken p-2">
                <div className="flex-1 min-w-[8rem]">
                  <label className="block text-[11px] text-text-muted mb-1">{t('pos.sellpack.renewOnPlan', 'Renew on plan')}</label>
                  <select className="input-field py-1 text-xs" aria-label={t('pos.sellpack.renewOnPlan', 'Renew on plan')} value={renewPlanId} onChange={(e) => setRenewPlanId(e.target.value)}>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}</option>)}
                  </select>
                </div>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => { const first = memberLookup.memberships[0]; if (first) startRenewal(first.id); }}
                  disabled={placing}
                >
                  {t('pos.sellpack.renewPay', 'Renew & pay')}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setShowMemberPanel(true)}>
                  {t('pos.new.manageMember', 'Manage member')}
                </button>
              </div>
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
              placeholder={t('pos.new.licensePlate', 'License plate *')}
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
            {/* Pack lines sit above the services: the plan is what makes the
                wash below it free, and the cashier reads the cart top-down. */}
            {sellPlan && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-2" data-testid="cart-plan-line">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-violet-900 truncate">{sellPlan.name}</p>
                    <p className="text-xs text-violet-700">{t('pos.new.membershipLine', 'New membership')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-violet-900">{fmt(sellPlan.price)}</span>
                    <button onClick={() => setSellPlan(null)} aria-label={t('pos.new.removePack', 'Remove pack')} className="w-6 h-6 rounded bg-white/70 text-violet-700">✕</button>
                  </div>
                </div>
                {cart.length > 0 && (
                  <p className="mt-1 text-[11px] text-violet-700">{t('pos.new.freeWashNote', "Today's wash is free with this plan — it still records as an upsell.")}</p>
                )}
              </div>
            )}
            {sellVoucherTpl && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 flex items-start justify-between gap-2" data-testid="cart-voucher-line">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-900 truncate">{sellVoucherTpl.name}</p>
                  <p className="text-xs text-amber-700">{t('pos.new.voucherPackLine', 'Voucher pack')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-amber-900">{fmt(sellVoucherTpl.salePrice)}</span>
                  <button onClick={() => setSellVoucherTpl(null)} aria-label={t('pos.new.removePack', 'Remove pack')} className="w-6 h-6 rounded bg-white/70 text-amber-700">✕</button>
                </div>
              </div>
            )}
            {cart.length === 0 && !sellPlan && !sellVoucherTpl ? (
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
                    {/* The field matches the item's configured discount TYPE: a
                        percent box for kind='percentage', Rupiah otherwise — it was
                        always Rupiah before (AIRIN-122/123). */}
                    <input
                      id={`disc-${l.serviceId}`}
                      type="number"
                      min={0}
                      max={isPctRule(l) ? linePctCap(l) : lineDiscountCap(l)}
                      className="input-field !py-1 !px-2 text-xs w-24"
                      placeholder={isPctRule(l) ? '0%' : 'Rp 0'}
                      value={(isPctRule(l) ? l.manualDiscountPct : l.manualDiscount) || ''}
                      onChange={(e) => changeDiscount(l.serviceId, e.target.value)}
                      aria-label={`${t('pos.new.discount', 'Discount')} — ${l.name}`}
                      data-testid={`line-discount-${l.serviceId}`}
                    />
                    <span className="text-[11px] text-text-muted">
                      {isPctRule(l)
                        ? `${t('pos.new.discountMaxHint', 'max')} ${linePctCap(l)}%${l.manualDiscount ? ` = ${fmt(l.manualDiscount)}` : ''}`
                        : `${t('pos.new.discountMaxHint', 'max')} ${fmt(lineDiscountCap(l))}`}
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
            {/* Subtotal is already NET of the member benefit and manual discount
                (AIRIN-150), so the member saving is itemised above it rather than
                subtracted again below. */}
            {memberPricing.total > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-secondary">{t('pos.new.memberBenefitLine', 'Member benefit')}</span>
                <span className="font-medium text-green-600">−{fmt(memberPricing.total)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.subtotal', 'Subtotal')}</span><span className="font-medium">{fmt(subtotal)}</span></div>
            {totalManualDiscount > 0 && (
              <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.manualDiscount', 'Manual discount')}</span><span className="font-medium text-green-600">−{fmt(totalManualDiscount)}</span></div>
            )}
            {promoDiscount > 0 && (
              <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.promoSectionTitle', 'Promo')}</span><span className="font-medium text-green-600">−{fmt(promoDiscount)}</span></div>
            )}
            {/* A plan makes the wash free, so the estimate must not keep showing
                the wash price the customer will not be charged. */}
            {sellPlan && cart.length > 0 && (
              <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.freeWashLine', 'Wash (free with plan)')}</span><span className="font-medium text-green-600">−{fmt(washSubtotal)}</span></div>
            )}
            {packSubtotal > 0 && (
              <div className="flex justify-between text-sm mb-1"><span className="text-text-secondary">{t('pos.new.packsLine', 'Membership / voucher pack')}</span><span className="font-medium">{fmt(packSubtotal)}</span></div>
            )}
            <div className="flex justify-between text-sm font-semibold mb-1"><span>{t('pos.new.estimatedTotal', 'Estimated total')}</span><span className="text-primary-600">{fmt(estimatedTotal)}</span></div>
            <p className="text-xs text-text-muted mb-3">{t('pos.new.serviceChargeTaxNote', 'Service charge & tax calculated at order time.')}</p>
            <button onClick={placeOrder} disabled={placing || (cart.length === 0 && !sellPlan && !sellVoucherTpl) || !openShift} className="btn-primary w-full">
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
              {/* Renewal happens right here now — there is no Sell Pack page to
                  send the cashier to any more. */}
              {memberAlert.canRenew && memberDetail && (
                <button
                  className="btn-primary"
                  onClick={() => { setMemberAlert(null); startRenewal(memberDetail.id); }}
                >
                  {t('pos.new.mAlertRenew', 'Renew now')}
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

      {/* A paid plan is still 'pending' until its plates are registered. */}
      {activation && (
        <PlateRegistrationModal
          membershipId={activation.membershipId}
          planName={activation.planName}
          maxPlates={activation.maxPlates}
          prefill={{ plate: activation.plate, brand: activation.brand, model: activation.model }}
          vehicleBrands={vehicleBrands}
          onDone={() => setActivation(null)}
        />
      )}

      {/* Codes for a paid voucher pack — shown once. */}
      {showIssuedModal && (
        <VoucherCodesModal
          issued={issued}
          issuing={issuing}
          error={error}
          onClose={() => { setShowIssuedModal(false); setIssued(null); }}
        />
      )}

      {/* Member management (plates / cancel), moved here from Sell Pack. */}
      {showMemberPanel && memberLookup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowMemberPanel(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <MemberManagementPanel member={memberLookup} onChanged={() => findMember()} />
            <button className="btn-secondary w-full mt-3" onClick={() => setShowMemberPanel(false)}>{t('pos.sellpack.close', 'Close')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
