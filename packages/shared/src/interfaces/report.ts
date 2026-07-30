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
  /** Id of whatever was sold: a service, a membership plan, or a voucher template. */
  serviceId: string;
  name: string;
  /**
   * What kind of product this row is. Memberships and voucher packs sell as
   * ordinary order lines since the POS merge (migration 089), so the product mix
   * is no longer services-only. Absent on responses from older backends.
   */
  kind?: 'service' | 'membership_plan' | 'voucher_pack';
  quantity: number;
  revenue: number;
}

/**
 * One day of the operational daily report — the shape of the sheet the owner
 * keeps by hand (money by payment rail, then the day's volume).
 * GET /api/reports/daily-operations
 */
export interface DailyOperationsRow {
  /** YYYY-MM-DD in Asia/Jakarta. */
  date: string;
  /**
   * Revenue keyed by payment rail: `cash`, `transfer`, or `method|UNIT`
   * (e.g. `qris_dynamic|AIRE`). Keys vary by tenant — pivot, don't assume.
   */
  payments: Record<string, number>;
  revenue: number;
  orders: number;
  /** Orders rung up against a membership, and the rest. */
  memberOrders: number;
  nonMemberOrders: number;
  /** Items sold per catalog category (car_wash / add_on / product). */
  itemsByCategory: Record<string, number>;
  /** Memberships sold new / renewed, keyed by the plan's duration in months. */
  newMemberships: Record<string, number>;
  renewals: Record<string, number>;
  voucherPacks: number;
}

/** One row of the item × agent matrix. */
export interface AgentPerformanceRow {
  item: string;
  group: 'membership' | 'voucher' | 'item';
  /** Count per agent name; agents with no sale of this item are absent. */
  byAgent: Record<string, number>;
  total: number;
}

/** GET /api/reports/agent-performance */
export interface AgentPerformanceReport {
  /** Column order; '—' (unassigned) always sorts last. */
  agents: string[];
  rows: AgentPerformanceRow[];
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
  /** Revenue and count breakdown by business unit (AIRE vs LEAD) */
  byBusinessUnit: Record<string, PaymentMethodBreakdown>;
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
  /**
   * Restrict to a set of branches. null/undefined = all branches; [] = none.
   * Resolved server-side from the caller's role + branch assignment.
   */
  outletIds?: string[] | null;
  /** Optional business-unit filter (AIRE / LEAD) */
  businessUnit?: string;
}
