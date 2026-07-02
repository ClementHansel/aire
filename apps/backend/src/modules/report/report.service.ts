import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  SummaryResponse,
  PaymentMethodBreakdown,
  ServiceBreakdown,
  ReportQueryParams,
} from '@aire/shared';

/**
 * ReportService handles generating summary reports, payment method breakdowns,
 * service breakdowns, and CSV export for the AIRE Operations Platform.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6
 */
@Injectable()
export class ReportService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Day-by-day sales: one row per day in the range with order count and
   * revenue (paid/confirmed/completed). Optional outlet filter.
   */
  async getDailySales(params: ReportQueryParams): Promise<{ date: string; orders: number; revenue: number; paidOrders: number }[]> {
    const { dateFrom, dateTo, outletId, businessUnit } = params;
    const qp: string[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND outlet_id = $${qp.length + 1}`; qp.push(outletId); }
    if (businessUnit) { filter += ` AND business_unit = $${qp.length + 1}`; qp.push(businessUnit); }
    const res = await this.pool.query<{ day: string; orders: string; revenue: string; paid: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total) FILTER (WHERE status IN ('paid','confirmed','completed')), 0) AS revenue,
              COUNT(*) FILTER (WHERE status IN ('paid','confirmed','completed'))::int AS paid
       FROM orders
       WHERE created_at >= $1::timestamptz AND created_at < ($2::date + INTERVAL '1 day') ${filter}
       GROUP BY day ORDER BY day ASC`,
      qp,
    );
    return res.rows.map((r) => ({ date: r.day, orders: parseInt(r.orders, 10), revenue: parseFloat(r.revenue), paidOrders: parseInt(r.paid, 10) }));
  }

  /** Shift-by-shift report: each register session with its sales + cash reconciliation. */
  async getShiftReport(params: ReportQueryParams): Promise<Record<string, unknown>[]> {
    const { dateFrom, dateTo, outletId } = params;
    const qp: string[] = [dateFrom, dateTo];
    let outletFilter = '';
    if (outletId) { outletFilter = ' AND s.outlet_id = $3'; qp.push(outletId); }
    const res = await this.pool.query(
      `SELECT s.id, s.operator_name, s.status, s.opening_float, s.closing_counted, s.expected_cash,
              s.variance, s.total_sales, s.cash_sales, s.non_cash_sales, s.order_count, s.opened_at, s.closed_at,
              o.outlet_count
       FROM pos_shifts s
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE status IN ('paid','confirmed','completed'))::int AS outlet_count
         FROM orders WHERE shift_id = s.id
       ) o ON true
       WHERE s.opened_at >= $1::timestamptz AND s.opened_at < ($2::date + INTERVAL '1 day') ${outletFilter}
       ORDER BY s.opened_at DESC`,
      qp,
    );
    return res.rows.map((s) => ({
      id: s.id,
      operator: s.operator_name,
      status: s.status,
      openingFloat: parseFloat(s.opening_float),
      // For open shifts, fall back to live order count
      orders: s.order_count != null ? s.order_count : s.outlet_count,
      totalSales: s.total_sales != null ? parseFloat(s.total_sales) : null,
      cashSales: s.cash_sales != null ? parseFloat(s.cash_sales) : null,
      nonCashSales: s.non_cash_sales != null ? parseFloat(s.non_cash_sales) : null,
      counted: s.closing_counted != null ? parseFloat(s.closing_counted) : null,
      expected: s.expected_cash != null ? parseFloat(s.expected_cash) : null,
      variance: s.variance != null ? parseFloat(s.variance) : null,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
    }));
  }

  /** CSV for day-by-day sales. */
  async exportDailySalesCsv(params: ReportQueryParams): Promise<string> {
    const rows = await this.getDailySales(params);
    const headers = ['Date', 'Orders', 'Paid Orders', 'Revenue'];
    const lines = [headers.join(','), ...rows.map((r) => [r.date, r.orders, r.paidOrders, r.revenue].join(','))];
    return lines.join('\n');
  }

  /**
   * Revenue + order-count time series grouped by day/week/month. Powers the
   * Transaction-tab charts (daily/weekly/monthly/custom range).
   */
  async getRevenueSeries(params: ReportQueryParams & { granularity?: 'day' | 'week' | 'month' }): Promise<{ period: string; revenue: number; orders: number }[]> {
    const { dateFrom, dateTo, outletId, businessUnit } = params;
    const gran = params.granularity ?? 'day';
    const trunc = gran === 'month' ? 'month' : gran === 'week' ? 'week' : 'day';
    const qp: string[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND outlet_id = $${qp.length + 1}`; qp.push(outletId); }
    if (businessUnit) { filter += ` AND business_unit = $${qp.length + 1}`; qp.push(businessUnit); }
    const res = await this.pool.query<{ period: string; revenue: string; orders: string }>(
      `SELECT to_char(date_trunc('${trunc}', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
              COALESCE(SUM(total) FILTER (WHERE status IN ('paid','confirmed','completed')), 0) AS revenue,
              COUNT(*) FILTER (WHERE status IN ('paid','confirmed','completed'))::int AS orders
       FROM orders
       WHERE created_at >= $1::timestamptz AND created_at < ($2::date + INTERVAL '1 day') ${filter}
       GROUP BY period ORDER BY period ASC`,
      qp,
    );
    return res.rows.map((r) => ({ period: r.period, revenue: parseFloat(r.revenue), orders: parseInt(r.orders, 10) }));
  }

  /** New customer counts over time (CRM-tab chart). */
  async getCustomerGrowth(tenantId: string, params: ReportQueryParams & { granularity?: 'day' | 'week' | 'month' }): Promise<{ period: string; newCustomers: number }[]> {
    const { dateFrom, dateTo } = params;
    const gran = params.granularity ?? 'day';
    const trunc = gran === 'month' ? 'month' : gran === 'week' ? 'week' : 'day';
    const res = await this.pool.query<{ period: string; n: string }>(
      `SELECT to_char(date_trunc('${trunc}', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
              COUNT(*)::int AS n
       FROM customers
       WHERE tenant_id = $3 AND created_at >= $1::timestamptz AND created_at < ($2::date + INTERVAL '1 day')
       GROUP BY period ORDER BY period ASC`,
      [dateFrom, dateTo, tenantId],
    );
    return res.rows.map((r) => ({ period: r.period, newCustomers: parseInt(r.n, 10) }));
  }

  /**
   * Generates a summary report for the given date range and optional outlet filter.
   *
   * - totalOrders: COUNT of all orders in date range
   * - revenue: SUM(total) WHERE status IN ('paid', 'confirmed', 'completed')
   * - paidCount: COUNT WHERE status IN ('paid', 'confirmed', 'completed')
   * - cancelledCount: COUNT WHERE status = 'cancelled'
   * - uniqueMembers: COUNT(DISTINCT customer_id) WHERE membership_id IS NOT NULL
   * - newMembers: COUNT(DISTINCT membership_id) from new activations in range
   * - byPaymentMethod: GROUP BY payment_method, SUM(total), COUNT(*)
   * - byService: JOIN order_items + services, GROUP BY service, ORDER BY quantity DESC LIMIT 10
   */
  async getSummary(params: ReportQueryParams): Promise<SummaryResponse> {
    const { dateFrom, dateTo, outletId, businessUnit } = params;

    const [
      overviewResult,
      paymentMethodResult,
      businessUnitResult,
      serviceResult,
    ] = await Promise.all([
      this.getOverviewStats(dateFrom, dateTo, outletId, businessUnit),
      this.getPaymentMethodBreakdown(dateFrom, dateTo, outletId, businessUnit),
      this.getBusinessUnitBreakdown(dateFrom, dateTo, outletId),
      this.getServiceBreakdown(dateFrom, dateTo, outletId, businessUnit),
    ]);

    return {
      ...overviewResult,
      byPaymentMethod: paymentMethodResult,
      byBusinessUnit: businessUnitResult,
      byService: serviceResult,
    };
  }

  /**
   * Resolve display names for the report scope (tenant + optional single outlet).
   * Used to brand the PDF header. Returns outletName = null for consolidated
   * (all-branches) reports.
   */
  async getScopeNames(
    tenantId: string,
    outletId?: string,
  ): Promise<{ tenantName: string; outletName: string | null }> {
    const t = await this.pool.query<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [tenantId],
    );
    let outletName: string | null = null;
    if (outletId) {
      const o = await this.pool.query<{ name: string }>(
        `SELECT name FROM outlets WHERE id = $1`,
        [outletId],
      );
      outletName = o.rows[0]?.name ?? null;
    }
    return { tenantName: t.rows[0]?.name ?? 'AIRE', outletName };
  }

  /**
   * Generates CSV content for orders in the given date range.
   * Returns CSV string with headers: Order Number, Date, Customer, Phone, Status,
   * Payment Method, Total, Items, Note
   */
  async exportCsv(params: ReportQueryParams): Promise<string> {
    const { dateFrom, dateTo, outletId, businessUnit } = params;

    const queryParams: (string | undefined)[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND o.outlet_id = $${queryParams.length + 1}`; queryParams.push(outletId); }
    if (businessUnit) { filter += ` AND o.business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

    const result = await this.pool.query<{
      order_number: string;
      created_at: Date;
      business_unit: string;
      customer_name: string;
      customer_phone: string;
      salesperson_name: string | null;
      status: string;
      payment_method: string | null;
      payment_channel: string | null;
      total: string;
      note: string | null;
      items: string;
    }>(
      `SELECT
        o.order_number,
        o.created_at,
        o.business_unit,
        o.customer_name,
        o.customer_phone,
        o.salesperson_name,
        o.status,
        o.payment_method,
        o.payment_channel,
        o.total,
        o.note,
        COALESCE(
          STRING_AGG(s.name || ' x' || oi.quantity, '; ' ORDER BY oi.sort_order),
          ''
        ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN services s ON s.id = oi.service_id
       WHERE o.created_at >= $1::timestamptz
         AND o.created_at < ($2::date + INTERVAL '1 day')
         ${filter}
       GROUP BY o.id, o.order_number, o.created_at, o.business_unit, o.customer_name,
                o.customer_phone, o.salesperson_name, o.status, o.payment_method,
                o.payment_channel, o.total, o.note
       ORDER BY o.created_at ASC`,
      queryParams.filter((p) => p !== undefined),
    );

    const headers = [
      'Order Number',
      'Date',
      'Business Unit',
      'Customer',
      'Phone',
      'Salesperson',
      'Status',
      'Payment Method',
      'Payment Channel',
      'Total',
      'Items',
      'Note',
    ];

    const rows = result.rows.map((row) => [
      this.escapeCsv(row.order_number),
      this.escapeCsv(new Date(row.created_at).toISOString()),
      this.escapeCsv(row.business_unit ?? ''),
      this.escapeCsv(row.customer_name),
      this.escapeCsv(row.customer_phone),
      this.escapeCsv(row.salesperson_name ?? ''),
      this.escapeCsv(row.status),
      this.escapeCsv(row.payment_method ?? ''),
      this.escapeCsv(row.payment_channel ?? ''),
      row.total,
      this.escapeCsv(row.items),
      this.escapeCsv(row.note ?? ''),
    ]);

    const csvLines = [headers.join(','), ...rows.map((r) => r.join(','))];
    return csvLines.join('\n');
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private async getOverviewStats(
    dateFrom: string,
    dateTo: string,
    outletId?: string,
    businessUnit?: string,
  ): Promise<Omit<SummaryResponse, 'byPaymentMethod' | 'byBusinessUnit' | 'byService'>> {
    const queryParams: string[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND outlet_id = $${queryParams.length + 1}`; queryParams.push(outletId); }
    if (businessUnit) { filter += ` AND business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

    const result = await this.pool.query<{
      total_orders: string;
      revenue: string;
      paid_count: string;
      cancelled_count: string;
      unique_members: string;
      new_members: string;
    }>(
      `SELECT
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(CASE WHEN status IN ('paid', 'confirmed', 'completed') THEN total ELSE 0 END), 0) AS revenue,
        COUNT(CASE WHEN status IN ('paid', 'confirmed', 'completed') THEN 1 END)::int AS paid_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int AS cancelled_count,
        COUNT(DISTINCT CASE WHEN membership_id IS NOT NULL THEN customer_id END)::int AS unique_members,
        COUNT(DISTINCT CASE WHEN membership_id IS NOT NULL AND status IN ('paid', 'confirmed', 'completed') THEN membership_id END)::int AS new_members
       FROM orders
       WHERE created_at >= $1::timestamptz
         AND created_at < ($2::date + INTERVAL '1 day')
         ${filter}`,
      queryParams,
    );

    const row = result.rows[0]!;
    return {
      totalOrders: parseInt(row.total_orders, 10),
      revenue: parseFloat(row.revenue),
      paidCount: parseInt(row.paid_count, 10),
      cancelledCount: parseInt(row.cancelled_count, 10),
      uniqueMembers: parseInt(row.unique_members, 10),
      newMembers: parseInt(row.new_members, 10),
    };
  }

  private async getPaymentMethodBreakdown(
    dateFrom: string,
    dateTo: string,
    outletId?: string,
    businessUnit?: string,
  ): Promise<Record<string, PaymentMethodBreakdown>> {
    const queryParams: string[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND outlet_id = $${queryParams.length + 1}`; queryParams.push(outletId); }
    if (businessUnit) { filter += ` AND business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

    const result = await this.pool.query<{
      payment_method: string;
      revenue: string;
      count: string;
    }>(
      `SELECT
        payment_method,
        COALESCE(SUM(total), 0) AS revenue,
        COUNT(*)::int AS count
       FROM orders
       WHERE created_at >= $1::timestamptz
         AND created_at < ($2::date + INTERVAL '1 day')
         AND status IN ('paid', 'confirmed', 'completed')
         AND payment_method IS NOT NULL
         ${filter}
       GROUP BY payment_method
       ORDER BY revenue DESC`,
      queryParams,
    );

    const breakdown: Record<string, PaymentMethodBreakdown> = {};
    for (const row of result.rows) {
      breakdown[row.payment_method] = {
        revenue: parseFloat(row.revenue),
        count: parseInt(row.count, 10),
      };
    }
    return breakdown;
  }

  /**
   * Revenue + order count split by business unit (AIRE car wash vs LEAD detailing).
   * Always returns both units (zero-filled) so the dashboard can render both P&L views.
   */
  private async getBusinessUnitBreakdown(
    dateFrom: string,
    dateTo: string,
    outletId?: string,
  ): Promise<Record<string, PaymentMethodBreakdown>> {
    const queryParams: string[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND outlet_id = $${queryParams.length + 1}`; queryParams.push(outletId); }

    const result = await this.pool.query<{ business_unit: string; revenue: string; count: string }>(
      `SELECT business_unit,
              COALESCE(SUM(total), 0) AS revenue,
              COUNT(*)::int AS count
       FROM orders
       WHERE created_at >= $1::timestamptz
         AND created_at < ($2::date + INTERVAL '1 day')
         AND status IN ('paid', 'confirmed', 'completed')
         ${filter}
       GROUP BY business_unit`,
      queryParams,
    );

    const breakdown: Record<string, PaymentMethodBreakdown> = {
      AIRE: { revenue: 0, count: 0 },
      LEAD: { revenue: 0, count: 0 },
    };
    for (const row of result.rows) {
      breakdown[row.business_unit] = {
        revenue: parseFloat(row.revenue),
        count: parseInt(row.count, 10),
      };
    }
    return breakdown;
  }

  private async getServiceBreakdown(
    dateFrom: string,
    dateTo: string,
    outletId?: string,
    businessUnit?: string,
  ): Promise<ServiceBreakdown[]> {
    const queryParams: string[] = [dateFrom, dateTo];
    let filter = '';
    if (outletId) { filter += ` AND o.outlet_id = $${queryParams.length + 1}`; queryParams.push(outletId); }
    if (businessUnit) { filter += ` AND o.business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

    const result = await this.pool.query<{
      service_id: string;
      name: string;
      total_quantity: string;
      total_revenue: string;
    }>(
      `SELECT
        oi.service_id,
        s.name,
        SUM(oi.quantity)::int AS total_quantity,
        COALESCE(SUM(oi.subtotal), 0) AS total_revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN services s ON s.id = oi.service_id
       WHERE o.created_at >= $1::timestamptz
         AND o.created_at < ($2::date + INTERVAL '1 day')
         AND o.status IN ('paid', 'confirmed', 'completed')
         ${filter}
       GROUP BY oi.service_id, s.name
       ORDER BY total_quantity DESC
       LIMIT 10`,
      queryParams,
    );

    return result.rows.map((row) => ({
      serviceId: row.service_id,
      name: row.name,
      quantity: parseInt(row.total_quantity, 10),
      revenue: parseFloat(row.total_revenue),
    }));
  }

  /**
   * Escapes a value for CSV output, wrapping in quotes if it contains
   * commas, quotes, or newlines.
   */
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
