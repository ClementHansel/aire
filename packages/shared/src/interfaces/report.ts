/**
 * Payment method breakdown entry showing revenue and count per method.
 */
export interface PaymentMethodBreakdown {
  revenue: number;
  count: number;
}

/**
 * Service breakdown entry showing top services by quantity and revenue.
 */
export interface ServiceBreakdown {
  serviceId: string;
  name: string;
  quantity: number;
  revenue: number;
}

/**
 * Summary report response.
 * GET /api/reports/summary?dateFrom=&dateTo=&outletId=
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6
 */
export interface SummaryResponse {
  /** Total number of orders in date range */
  totalOrders: number;
  /** Total revenue from paid/confirmed/completed orders */
  revenue: number;
  /** Count of paid/confirmed/completed orders */
  paidCount: number;
  /** Count of cancelled orders */
  cancelledCount: number;
  /** Count of unique members (distinct customers with membership) served */
  uniqueMembers: number;
  /** Count of new memberships activated in date range */
  newMembers: number;
  /** Revenue and count breakdown by payment method */
  byPaymentMethod: Record<string, PaymentMethodBreakdown>;
  /** Top 10 services by quantity and revenue */
  byService: ServiceBreakdown[];
}

/**
 * Report query parameters.
 * GET /api/reports/summary, GET /api/reports/export
 */
export interface ReportQueryParams {
  dateFrom: string;
  dateTo: string;
  outletId?: string;
}
