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
  page?: number;
  pageSize?: number;
}

/**
 * A single order item returned in the order card.
 */
export interface OrderCardItem {
  serviceName: string;
  quantity: number;
  subtotal: number;
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
  total: number;
  createdAt: string;
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
