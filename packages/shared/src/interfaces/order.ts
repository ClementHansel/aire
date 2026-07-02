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
  voucherCodes?: string[];
  membershipId?: string;
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
