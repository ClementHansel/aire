import { OrderStatus } from '../enums';

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
  voucherCodes?: string[];
  membershipId?: string;
  selectedPlate?: string;
  note?: string;
}

/**
 * Pay order request body.
 * POST /api/orders/:id/pay
 */
export interface PayOrderRequest {
  method: 'cash' | 'qris_static' | 'qris_dynamic' | 'edc' | 'transfer';
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
