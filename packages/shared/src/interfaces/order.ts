import { OrderStatus, BusinessUnit } from '../enums';

/**
 * Order item within a create order request.
 */
export interface OrderItemInput {
  serviceId: string;
  quantity: number;
  manualDiscount?: number;
}

/**
 * Customer info attached to an order.
 */
export interface OrderCustomerInput {
  name: string;
  phone: string;
  licensePlate?: string;
  brand?: string;
  model?: string;
}

/**
 * Create order request body.
 * POST /api/orders
 */
export interface CreateOrderRequest {
  customer: OrderCustomerInput;
  items: OrderItemInput[];
  /** Business unit for this transaction (AIRE car wash / LEAD detailing). Defaults to AIRE. */
  businessUnit?: BusinessUnit;
  /** Salesperson credited for this transaction (distinct from the logged-in cashier). */
  salespersonName?: string;
  /** Employee credited for this sale — links the sale to an employee for commission accrual. */
  salespersonEmployeeId?: string;
  voucherCodes?: string[];
  membershipId?: string;
  /**
   * Membership plan SOLD on this order (a counter upsell), as opposed to
   * `membershipId`, which is an EXISTING membership being used to price the
   * wash. Selling a plan here adds a plan line to the order, creates the
   * membership (pending until payment + plate registration), and makes the
   * order's car-wash lines free — the "beli langganan sambil cuci" case that
   * used to need a second order on the separate Sell Pack page.
   */
  membershipPlanId?: string;
  /** Voucher pack sold on this order — same one-transaction rule as membershipPlanId. */
  voucherPackTemplateId?: string;
  /**
   * Promotions the cashier explicitly chose to apply. Promotions are NO LONGER
   * auto-applied — checkout only applies the ids listed here, and each is
   * re-validated server-side (active, in-window, quota, outlet, service trigger,
   * min_purchase, and member_only vs the order's membership). Omitted/empty → no
   * promo discount.
   */
  promotionIds?: string[];
  selectedPlate?: string;
  note?: string;
  /**
   * Branch the operator is actually working at. POS follows the HR schedule, so
   * this may differ from the operator's home outlet. Omitted → the operator's own
   * outlet is used (unchanged behavior). Must be a branch in the tenant; if it is
   * not today's scheduled branch, offScheduleReason is required.
   */
  operatingOutletId?: string;
  /** Reason for operating a branch other than today's scheduled one (audit-logged). */
  offScheduleReason?: string;
  /**
   * Vehicle-queue entry this order is being rung up for (POS "order from queue").
   * When supplied, the created order is linked back to the queue entry so the
   * queue board can show it as paid/unpaid. Service status stays independent.
   */
  queueEntryId?: string;
  /**
   * Ordering interface that created this order. Defaults to 'pos'. Customer/kiosk
   * channels block out-of-stock products; the POS is not gated.
   */
  channel?: 'pos' | 'kiosk' | 'customer';
}

/** Request body for POST /api/orders/promotions/preview (POS promo picker). */
export interface PromoPreviewRequest {
  items: OrderItemInput[];
  membershipId?: string;
  operatingOutletId?: string;
  voucherCodes?: string[];
}

/** One promotion the cashier may choose to apply, with its computed discount. */
export interface PromoOption {
  id: string;
  name: string;
  rewardType: string;
  rewardValue: number;
  /** Rupiah this promo would take off the current subtotal. */
  amount: number;
  memberOnly: boolean;
  stackable: boolean;
  minPurchase: number;
  /** True when the order currently satisfies every gate (member/min/outlet/service). */
  eligible: boolean;
  /** Human-readable reason when not eligible (for the POS to show greyed-out). */
  reason?: string;
}


/**
 * Pay order request body.
 * POST /api/orders/:id/pay
 */
export interface PayOrderRequest {
  method: 'cash' | 'qris_static' | 'qris_dynamic' | 'edc' | 'cc' | 'transfer';
  /** Payment channel (which business-unit account the money lands in). Defaults to the order's business unit. */
  paymentChannel?: BusinessUnit;
  /** Amount received from customer (required for cash payments) */
  amountReceived?: number;
  /** Reference number (required for EDC/transfer payments) */
  referenceNumber?: string;
}

/**
 * Void order request body.
 * POST /api/orders/:id/void
 */
export interface VoidOrderRequest {
  reason: string;
  /** Admin PIN required after free void window expires */
  adminPin?: string;
}

/**
 * Order status transition request.
 * PATCH /api/orders/:id/status
 */
export interface UpdateOrderStatusRequest {
  status: OrderStatus;
}

/**
 * Order query parameters for listing/filtering.
 * GET /api/orders
 */
export interface OrderQueryParams {
  /** Tenant scope — REQUIRED. Every list query must be bound to one tenant. */
  tenantId: string;
  status?: OrderStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  outletId?: string;
  /** Restrict to a set of branches (role-resolved). null/undefined = all; [] = none. */
  outletIds?: string[] | null;
  /**
   * Operator whose own orders are always visible, regardless of `outletIds`.
   *
   * A shift can be opened at a branch outside the operator's assigned set, and
   * orders are booked to the shift's branch — so a cover-shift cashier used to
   * ring up orders that immediately vanished from their own Orders list while
   * still showing on the owner's dashboard (AIRIN-110). This widens the branch
   * filter by exactly one row-level rule ("I rang this up") rather than granting
   * the whole branch.
   */
  alwaysVisibleOperatorId?: string;
  /** Settlement method filter (cash/qris_static/qris_dynamic/edc/cc/transfer). */
  paymentMethod?: string;
  /**
   * Member filter. 'member' = the order was rung up against a membership
   * (orders.membership_id set at checkout); 'non_member' = it was not. This is
   * per-ORDER, not per-customer: a member who pays for an extra wash without
   * attaching their membership counts as non_member for that order.
   */
  memberFilter?: 'member' | 'non_member';
  page?: number;
  pageSize?: number;
}

/**
 * A single order item returned in the order card.
 */
export interface OrderCardItem {
  /**
   * The service behind this line, or null for a membership-plan / voucher-pack
   * line. Needed to match a free-service voucher to the line it covered.
   */
  serviceId?: string | null;
  serviceName: string;
  quantity: number;
  subtotal: number;
  /**
   * What kind of line this is: a normal 'service'/'product', or the
   * 'membership_plan' / 'voucher_pack' sold on this order. Lets a list say
   * *what* was bought rather than showing a bare name (AIRIN-115).
   */
  itemType?: string | null;
  /**
   * True when this line was priced by a membership benefit (free or member rate)
   * rather than sold at list price. A Rp 0 line beside a full-price one is
   * otherwise unexplained — the reader cannot tell a membership from a voucher or
   * a cashier discount.
   */
  isMemberPricing?: boolean;
  /** 'free' | 'percentage' | 'fixed' — which KIND of member benefit priced it. */
  memberDiscountType?: string | null;
  /** 1 for free, the fraction for a percentage, or the fixed member unit price. */
  memberDiscountValue?: number | null;
  /** Amount taken off this line, whatever the reason. 0 when nothing was. */
  discount?: number;
}

/**
 * A named reason money came off an order: a promotion, or a redeemed voucher.
 * Membership benefits are reported per line instead (see OrderCardItem), because
 * that is the level at which they apply.
 */
export interface OrderDiscountSource {
  /**
   * 'promo' and 'voucher' took money off THIS order. 'campaign' is the other
   * direction: the order triggered a campaign and earned the customer a bonus,
   * which is otherwise invisible on the transaction that caused it.
   */
  kind: 'promo' | 'voucher' | 'campaign';
  /** Human label — the promotion's name, or the voucher's benefit plus its code. */
  label: string;
  /** Money attributed, where it was recorded (promotions); null otherwise. */
  amount: number | null;
  /** The service a free-service voucher covered, so a line can be tagged exactly. */
  coversServiceId?: string | null;
  /**
   * The campaign behind this. For a redeemed voucher it answers "where did the
   * customer get this?"; for kind 'campaign' it is the campaign that just fired.
   */
  viaCampaign?: string | null;
}

/**
 * Order card shape returned in the order list response.
 */
export interface OrderCard {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  licensePlate?: string;
  vehicleBrand?: string;
  operatorName: string;
  status: OrderStatus;
  items: OrderCardItem[];
  /** Pre-charges/discount sum of line items. */
  subtotal: number;
  serviceCharge: number;
  tax: number;
  voucherDiscount: number;
  promoDiscount: number;
  /** Settlement method once paid (cash/qris_static/qris_dynamic/edc/cc/transfer); null while unpaid. */
  paymentMethod?: string | null;
  /** True when the order was rung up against a membership (see OrderQueryParams.memberFilter). */
  isMember?: boolean;
  total: number;
  createdAt: string;
  /** Named promotions/vouchers that discounted this order (see OrderDiscountSource). */
  discountSources?: OrderDiscountSource[];
}

/**
 * Paginated order list response.
 * GET /api/orders
 */
export interface OrderListResponse {
  orders: OrderCard[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
