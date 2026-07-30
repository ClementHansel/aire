import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  SummaryResponse,
  PaymentMethodBreakdown,
  ServiceBreakdown,
  ReportQueryParams,
  DailyOperationsRow,
  AgentPerformanceReport,
  AgentPerformanceRow,
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
  async getDailySales(tenantId: string, params: ReportQueryParams): Promise<{ date: string; orders: number; revenue: number; paidOrders: number }[]> {
    const { dateFrom, dateTo, outletIds, businessUnit } = params;
    const qp: unknown[] = [dateFrom, dateTo];
    qp.push(tenantId); const tf = ` AND tenant_id = $${qp.length}`;
    let filter = '';
    if (outletIds != null) { filter += ` AND outlet_id = ANY($${qp.length + 1}::uuid[])`; qp.push(outletIds); }
    if (businessUnit) { filter += ` AND business_unit = $${qp.length + 1}`; qp.push(businessUnit); }
    const res = await this.pool.query<{ day: string; orders: string; revenue: string; paid: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total) FILTER (WHERE status IN ('paid','confirmed','completed')), 0) AS revenue,
              COUNT(*) FILTER (WHERE status IN ('paid','confirmed','completed'))::int AS paid
       FROM orders
       WHERE created_at >= $1::timestamptz AND created_at < ($2::date + INTERVAL '1 day') ${tf} ${filter}
       GROUP BY day ORDER BY day ASC`,
      qp,
    );
    return res.rows.map((r) => ({ date: r.day, orders: parseInt(r.orders, 10), revenue: parseFloat(r.revenue), paidOrders: parseInt(r.paid, 10) }));
  }

  /**
   * "DAILY REVENUE REPORT" — one row per day, modelled on the sheet the owner
   * keeps by hand today (Samuel 2026-07-30): money split by payment method AND
   * business unit, then the day's volume — orders, member vs non-member, items
   * by category, memberships sold new vs renewed (by plan length), and voucher
   * packs.
   *
   * Payment keys are `method` for un-split methods and `method|UNIT` where the
   * settlement channel matters (their sheet has separate qris / debit / cc
   * columns for AIRE and LEAD). The caller pivots whatever keys come back rather
   * than assuming a fixed column set, so a tenant with different methods or a
   * single business unit still gets a correct table.
   */
  async getDailyOperations(
    tenantId: string,
    params: ReportQueryParams,
  ): Promise<DailyOperationsRow[]> {
    const { dateFrom, dateTo, outletIds, businessUnit } = params;

    // One parameter list shared by every branch below: $1 dateFrom, $2 dateTo,
    // $3 tenant, then the optional outlet/business-unit filters.
    const qp: unknown[] = [dateFrom, dateTo, tenantId];
    let orderFilter = '';
    if (outletIds != null) { orderFilter += ` AND o.outlet_id = ANY($${qp.length + 1}::uuid[])`; qp.push(outletIds); }
    if (businessUnit) { orderFilter += ` AND o.business_unit = $${qp.length + 1}`; qp.push(businessUnit); }
    const outletParamIdx = outletIds != null ? 4 : null;

    const WINDOW = `o.created_at >= $1::timestamptz AND o.created_at < ($2::date + INTERVAL '1 day')
                    AND o.tenant_id = $3 AND o.status IN ('paid','confirmed','completed')`;
    const DAY = `to_char(o.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

    const [payments, volume, categories, newMembers, renewals, vouchers] = await Promise.all([
      // Money in, by method × settlement channel.
      this.pool.query<{ day: string; method: string | null; channel: string | null; revenue: string }>(
        `SELECT ${DAY} AS day, o.payment_method AS method,
                COALESCE(o.payment_channel, o.business_unit) AS channel,
                COALESCE(SUM(o.total), 0) AS revenue
         FROM orders o WHERE ${WINDOW} ${orderFilter}
         GROUP BY day, method, channel`,
        qp,
      ),
      // Volume + member split.
      this.pool.query<{ day: string; orders: string; member: string }>(
        `SELECT ${DAY} AS day, COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE o.membership_id IS NOT NULL)::int AS member
         FROM orders o WHERE ${WINDOW} ${orderFilter}
         GROUP BY day`,
        qp,
      ),
      // Items sold by catalog category (their CW / TREAT / PRODUCT columns).
      this.pool.query<{ day: string; category: string; qty: string }>(
        `SELECT ${DAY} AS day, s.category, SUM(oi.quantity)::int AS qty
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN services s ON s.id = oi.service_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY day, s.category`,
        qp,
      ),
      // Memberships sold new, by plan length.
      this.pool.query<{ day: string; months: number; n: string }>(
        `SELECT ${DAY} AS day, p.duration_months AS months, COUNT(*)::int AS n
         FROM memberships m
         JOIN orders o ON o.id = m.order_id
         JOIN membership_plans p ON p.id = m.plan_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY day, months`,
        qp,
      ),
      // Renewals, by plan length.
      this.pool.query<{ day: string; months: number; n: string }>(
        `SELECT ${DAY} AS day, p.duration_months AS months, COUNT(*)::int AS n
         FROM membership_renewals r
         JOIN orders o ON o.id = r.order_id
         JOIN membership_plans p ON p.id = r.plan_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY day, months`,
        qp,
      ),
      // Voucher packs sold — both the code-pack product and the shareable
      // ticket books, since a buyer experiences both as "beli paket voucher".
      this.pool.query<{ day: string; n: string }>(
        `SELECT day, COUNT(*)::int AS n FROM (
           SELECT ${DAY} AS day
           FROM voucher_packs vp JOIN orders o ON o.id = vp.order_id
           WHERE ${WINDOW} ${orderFilter}
           UNION ALL
           SELECT to_char(b.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day
           FROM voucher_books b
           WHERE b.tenant_id = $3
             AND b.created_at >= $1::timestamptz
             AND b.created_at < ($2::date + INTERVAL '1 day')
             ${outletParamIdx ? `AND b.outlet_id = ANY($${outletParamIdx}::uuid[])` : ''}
         ) x GROUP BY day`,
        qp,
      ),
    ]);

    const rows = new Map<string, DailyOperationsRow>();
    const row = (day: string): DailyOperationsRow => {
      let r = rows.get(day);
      if (!r) {
        r = {
          date: day, payments: {}, revenue: 0, orders: 0, memberOrders: 0, nonMemberOrders: 0,
          itemsByCategory: {}, newMemberships: {}, renewals: {}, voucherPacks: 0,
        };
        rows.set(day, r);
      }
      return r;
    };

    for (const p of payments.rows) {
      const r = row(p.day);
      const method = p.method ?? 'unpaid';
      // cash and transfer are never split by channel in their sheet — the split
      // only carries information for the card/QRIS rails.
      const key = method === 'cash' || method === 'transfer' || !p.channel ? method : `${method}|${p.channel}`;
      const amount = parseFloat(p.revenue);
      r.payments[key] = (r.payments[key] ?? 0) + amount;
      r.revenue += amount;
    }
    for (const v of volume.rows) {
      const r = row(v.day);
      r.orders = parseInt(v.orders, 10);
      r.memberOrders = parseInt(v.member, 10);
      r.nonMemberOrders = r.orders - r.memberOrders;
    }
    for (const c of categories.rows) row(c.day).itemsByCategory[c.category] = parseInt(c.qty, 10);
    for (const m of newMembers.rows) row(m.day).newMemberships[String(m.months)] = parseInt(m.n, 10);
    for (const m of renewals.rows) row(m.day).renewals[String(m.months)] = parseInt(m.n, 10);
    for (const v of vouchers.rows) row(v.day).voucherPacks = parseInt(v.n, 10);

    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * "ITEM × AGENT" matrix — what each salesperson sold in the period, the second
   * report the owner keeps by hand: memberships (new / renewal, by plan length),
   * voucher packs, and each product or service, counted per agent.
   *
   * The agent is the salesperson credited on the order (`salesperson_name`),
   * NOT the cashier who operated the till; orders with nobody credited are
   * grouped under a single "unassigned" column so the totals still reconcile.
   */
  async getAgentPerformance(
    tenantId: string,
    params: ReportQueryParams,
  ): Promise<AgentPerformanceReport> {
    const { dateFrom, dateTo, outletIds, businessUnit } = params;
    const qp: unknown[] = [dateFrom, dateTo, tenantId];
    let orderFilter = '';
    if (outletIds != null) { orderFilter += ` AND o.outlet_id = ANY($${qp.length + 1}::uuid[])`; qp.push(outletIds); }
    if (businessUnit) { orderFilter += ` AND o.business_unit = $${qp.length + 1}`; qp.push(businessUnit); }

    const WINDOW = `o.created_at >= $1::timestamptz AND o.created_at < ($2::date + INTERVAL '1 day')
                    AND o.tenant_id = $3 AND o.status IN ('paid','confirmed','completed')`;
    const AGENT = `COALESCE(NULLIF(TRIM(o.salesperson_name), ''), '—')`;

    const [newMembers, renewals, vouchers, items] = await Promise.all([
      this.pool.query<{ agent: string; months: number; n: string }>(
        `SELECT ${AGENT} AS agent, p.duration_months AS months, COUNT(*)::int AS n
         FROM memberships m
         JOIN orders o ON o.id = m.order_id
         JOIN membership_plans p ON p.id = m.plan_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY agent, months`,
        qp,
      ),
      this.pool.query<{ agent: string; months: number; n: string }>(
        `SELECT ${AGENT} AS agent, p.duration_months AS months, COUNT(*)::int AS n
         FROM membership_renewals r
         JOIN orders o ON o.id = r.order_id
         JOIN membership_plans p ON p.id = r.plan_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY agent, months`,
        qp,
      ),
      this.pool.query<{ agent: string; n: string }>(
        `SELECT ${AGENT} AS agent, COUNT(*)::int AS n
         FROM voucher_packs vp JOIN orders o ON o.id = vp.order_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY agent`,
        qp,
      ),
      // Every sold line, pack lines included (they carry item_name since 089).
      this.pool.query<{ agent: string; name: string; kind: string; qty: string }>(
        `SELECT ${AGENT} AS agent, COALESCE(s.name, oi.item_name) AS name,
                oi.item_type AS kind, SUM(oi.quantity)::int AS qty
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN services s ON s.id = oi.service_id
         WHERE ${WINDOW} ${orderFilter}
         GROUP BY agent, name, kind`,
        qp,
      ),
    ]);

    const agents = new Set<string>();
    const lines = new Map<string, AgentPerformanceRow>();
    const add = (label: string, group: AgentPerformanceRow['group'], agent: string, n: number) => {
      agents.add(agent);
      let r = lines.get(label);
      if (!r) { r = { item: label, group, byAgent: {}, total: 0 }; lines.set(label, r); }
      r.byAgent[agent] = (r.byAgent[agent] ?? 0) + n;
      r.total += n;
    };

    for (const r of newMembers.rows) add(`NEW MBR (${r.months}mth)`, 'membership', r.agent, parseInt(r.n, 10));
    for (const r of renewals.rows) add(`RENEWAL (${r.months}mth)`, 'membership', r.agent, parseInt(r.n, 10));
    for (const r of vouchers.rows) add('BELI PAKET VOU', 'voucher', r.agent, parseInt(r.n, 10));
    for (const r of items.rows) {
      // Membership/voucher pack lines are already counted above from their own
      // tables — counting the line too would double every merged-POS sale.
      if (r.kind !== 'service') continue;
      add(r.name, 'item', r.agent, parseInt(r.qty, 10));
    }

    const order: Record<AgentPerformanceRow['group'], number> = { membership: 0, voucher: 1, item: 2 };
    return {
      agents: [...agents].sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b))),
      rows: [...lines.values()].sort(
        (a, b) => order[a.group] - order[b.group] || b.total - a.total || a.item.localeCompare(b.item),
      ),
    };
  }

  /** Shift-by-shift report: each register session with its sales + cash reconciliation. */
  async getShiftReport(tenantId: string, params: ReportQueryParams): Promise<Record<string, unknown>[]> {
    const { dateFrom, dateTo, outletIds } = params;
    const qp: unknown[] = [dateFrom, dateTo];
    qp.push(tenantId); const tf = ` AND s.tenant_id = $${qp.length}`;
    let outletFilter = '';
    if (outletIds != null) { outletFilter = ` AND s.outlet_id = ANY($${qp.length + 1}::uuid[])`; qp.push(outletIds); }
    const res = await this.pool.query(
      `SELECT s.id, s.operator_name, s.status, s.opening_float, s.closing_counted, s.expected_cash,
              s.variance, s.total_sales, s.cash_sales, s.non_cash_sales, s.order_count, s.opened_at, s.closed_at,
              o.outlet_count
       FROM pos_shifts s
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE status IN ('paid','confirmed','completed'))::int AS outlet_count
         FROM orders WHERE shift_id = s.id
       ) o ON true
       WHERE s.opened_at >= $1::timestamptz AND s.opened_at < ($2::date + INTERVAL '1 day') ${tf} ${outletFilter}
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
  async exportDailySalesCsv(tenantId: string, params: ReportQueryParams): Promise<string> {
    const rows = await this.getDailySales(tenantId, params);
    const headers = ['Date', 'Orders', 'Paid Orders', 'Revenue'];
    const lines = [headers.join(','), ...rows.map((r) => [r.date, r.orders, r.paidOrders, r.revenue].join(','))];
    return lines.join('\n');
  }

  /**
   * Revenue + order-count time series grouped by day/week/month. Powers the
   * Transaction-tab charts (daily/weekly/monthly/custom range).
   */
  async getRevenueSeries(tenantId: string, params: ReportQueryParams & { granularity?: 'day' | 'week' | 'month' }): Promise<{ period: string; revenue: number; orders: number }[]> {
    const { dateFrom, dateTo, outletIds, businessUnit } = params;
    const gran = params.granularity ?? 'day';
    const trunc = gran === 'month' ? 'month' : gran === 'week' ? 'week' : 'day';
    const qp: unknown[] = [dateFrom, dateTo];
    qp.push(tenantId); const tf = ` AND tenant_id = $${qp.length}`;
    let filter = '';
    if (outletIds != null) { filter += ` AND outlet_id = ANY($${qp.length + 1}::uuid[])`; qp.push(outletIds); }
    if (businessUnit) { filter += ` AND business_unit = $${qp.length + 1}`; qp.push(businessUnit); }
    const res = await this.pool.query<{ period: string; revenue: string; orders: string }>(
      `SELECT to_char(date_trunc('${trunc}', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS period,
              COALESCE(SUM(total) FILTER (WHERE status IN ('paid','confirmed','completed')), 0) AS revenue,
              COUNT(*) FILTER (WHERE status IN ('paid','confirmed','completed'))::int AS orders
       FROM orders
       WHERE created_at >= $1::timestamptz AND created_at < ($2::date + INTERVAL '1 day') ${tf} ${filter}
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
      `SELECT to_char(date_trunc('${trunc}', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS period,
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
   * - byService: every sold line (services AND membership plans / voucher packs,
   *   plus pre-merge pack orders that carry no line items), GROUP BY item,
   *   ORDER BY revenue DESC LIMIT 20
   */
  async getSummary(tenantId: string, params: ReportQueryParams): Promise<SummaryResponse> {
    const { dateFrom, dateTo, outletIds, businessUnit } = params;

    const [
      overviewResult,
      paymentMethodResult,
      businessUnitResult,
      serviceResult,
    ] = await Promise.all([
      this.getOverviewStats(tenantId, dateFrom, dateTo, outletIds, businessUnit),
      this.getPaymentMethodBreakdown(tenantId, dateFrom, dateTo, outletIds, businessUnit),
      this.getBusinessUnitBreakdown(tenantId, dateFrom, dateTo, outletIds, businessUnit),
      this.getServiceBreakdown(tenantId, dateFrom, dateTo, outletIds, businessUnit),
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
  async exportCsv(tenantId: string, params: ReportQueryParams): Promise<string> {
    const { dateFrom, dateTo, outletIds, businessUnit } = params;

    const queryParams: unknown[] = [dateFrom, dateTo];
    queryParams.push(tenantId); const tf = ` AND o.tenant_id = $${queryParams.length}`;
    let filter = tf;
    if (outletIds != null) { filter += ` AND o.outlet_id = ANY($${queryParams.length + 1}::uuid[])`; queryParams.push(outletIds); }
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
    tenantId: string,
    dateFrom: string,
    dateTo: string,
    outletIds?: string[] | null,
    businessUnit?: string,
  ): Promise<Omit<SummaryResponse, 'byPaymentMethod' | 'byBusinessUnit' | 'byService'>> {
    const queryParams: unknown[] = [dateFrom, dateTo];
    queryParams.push(tenantId); let filter = ` AND tenant_id = $${queryParams.length}`;
    if (outletIds != null) { filter += ` AND outlet_id = ANY($${queryParams.length + 1}::uuid[])`; queryParams.push(outletIds); }
    if (businessUnit) { filter += ` AND business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

    const result = await this.pool.query<{
      total_orders: string;
      revenue: string;
      paid_count: string;
      cancelled_count: string;
      unique_members: string;
    }>(
      `SELECT
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(CASE WHEN status IN ('paid', 'confirmed', 'completed') THEN total ELSE 0 END), 0) AS revenue,
        COUNT(CASE WHEN status IN ('paid', 'confirmed', 'completed') THEN 1 END)::int AS paid_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int AS cancelled_count,
        COUNT(DISTINCT CASE WHEN membership_id IS NOT NULL THEN customer_id END)::int AS unique_members
       FROM orders
       WHERE created_at >= $1::timestamptz
         AND created_at < ($2::date + INTERVAL '1 day')
         ${filter}`,
      queryParams,
    );

    // New members = memberships actually SIGNED UP (created) in the window, counted
    // from the memberships table — NOT from orders. Counting members who transacted
    // (the old query) merely re-derived uniqueMembers. Scoped by the membership's
    // home outlet when an outlet filter is applied.
    const nmParams: unknown[] = [dateFrom, dateTo, tenantId];
    let nmFilter = '';
    if (outletIds != null) { nmParams.push(outletIds); nmFilter = ` AND home_outlet_id = ANY($${nmParams.length}::uuid[])`; }
    const nm = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM memberships
       WHERE tenant_id = $3
         AND created_at >= $1::timestamptz
         AND created_at < ($2::date + INTERVAL '1 day')${nmFilter}`,
      nmParams,
    );

    const row = result.rows[0]!;
    return {
      totalOrders: parseInt(row.total_orders, 10),
      revenue: parseFloat(row.revenue),
      paidCount: parseInt(row.paid_count, 10),
      cancelledCount: parseInt(row.cancelled_count, 10),
      uniqueMembers: parseInt(row.unique_members, 10),
      newMembers: parseInt(nm.rows[0]?.n ?? '0', 10),
    };
  }

  private async getPaymentMethodBreakdown(
    tenantId: string,
    dateFrom: string,
    dateTo: string,
    outletIds?: string[] | null,
    businessUnit?: string,
  ): Promise<Record<string, PaymentMethodBreakdown>> {
    const queryParams: unknown[] = [dateFrom, dateTo];
    queryParams.push(tenantId); let filter = ` AND tenant_id = $${queryParams.length}`;
    if (outletIds != null) { filter += ` AND outlet_id = ANY($${queryParams.length + 1}::uuid[])`; queryParams.push(outletIds); }
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
    tenantId: string,
    dateFrom: string,
    dateTo: string,
    outletIds?: string[] | null,
    businessUnit?: string,
  ): Promise<Record<string, PaymentMethodBreakdown>> {
    const queryParams: unknown[] = [dateFrom, dateTo];
    queryParams.push(tenantId); let filter = ` AND tenant_id = $${queryParams.length}`;
    if (outletIds != null) { filter += ` AND outlet_id = ANY($${queryParams.length + 1}::uuid[])`; queryParams.push(outletIds); }
    // This breakdown was the only one of the four in getSummary() that ignored
    // the business-unit filter, so selecting a unit narrowed every KPI while the
    // BU split card — the most prominent BU element on the page — kept showing
    // both units at full revenue. That read as "the filter does nothing"
    // (AIRIN-130). The unselected unit is still returned zero-filled below, so
    // the caller decides whether to render it.
    if (businessUnit) { filter += ` AND business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

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
    tenantId: string,
    dateFrom: string,
    dateTo: string,
    outletIds?: string[] | null,
    businessUnit?: string,
  ): Promise<ServiceBreakdown[]> {
    const queryParams: unknown[] = [dateFrom, dateTo];
    queryParams.push(tenantId); let filter = ` AND o.tenant_id = $${queryParams.length}`;
    if (outletIds != null) { filter += ` AND o.outlet_id = ANY($${queryParams.length + 1}::uuid[])`; queryParams.push(outletIds); }
    if (businessUnit) { filter += ` AND o.business_unit = $${queryParams.length + 1}`; queryParams.push(businessUnit); }

    // Every sold line, whatever its kind. Membership plans and voucher packs are
    // ordinary order_items since migration 089, so the owner's "penjualan per
    // produk" finally answers with the whole product mix instead of services
    // only (Samuel 2026-07-30). LEFT JOIN + COALESCE because a pack line has no
    // services row — its label is the name snapshotted at sale time.
    //
    // Grouping key is the line's own target id, so two plans never collapse into
    // one row just because service_id is NULL on both.
    const result = await this.pool.query<{
      item_id: string;
      name: string;
      kind: string;
      total_quantity: string;
      total_revenue: string;
    }>(
      `WITH sold AS (
         SELECT
           COALESCE(oi.service_id, oi.membership_plan_id, oi.voucher_template_id)::text AS item_id,
           COALESCE(s.name, oi.item_name) AS name,
           oi.item_type AS kind,
           oi.quantity AS qty,
           oi.subtotal AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN services s ON s.id = oi.service_id
         WHERE o.created_at >= $1::timestamptz
           AND o.created_at < ($2::date + INTERVAL '1 day')
           AND o.status IN ('paid', 'confirmed', 'completed')
           ${filter}

         UNION ALL

         -- Pack sales made BEFORE the POS merge (migration 089) live on orders
         -- that createPackOrder wrote with no line items at all. Without this
         -- branch every membership sold up to 2026-07-30 would silently vanish
         -- from the product mix the day the new path went live. The NOT EXISTS
         -- is what keeps it from double-counting the new path, whose packs are
         -- real line items counted above.
         SELECT
           COALESCE(m.plan_id::text, vp.template_id::text, o.id::text) AS item_id,
           COALESCE(mp.name, vt.name, 'Pack sale') AS name,
           CASE WHEN m.id IS NOT NULL THEN 'membership_plan' ELSE 'voucher_pack' END AS kind,
           1 AS qty,
           o.total AS revenue
         FROM orders o
         LEFT JOIN memberships m ON m.order_id = o.id
         LEFT JOIN membership_plans mp ON mp.id = m.plan_id
         LEFT JOIN voucher_packs vp ON vp.order_id = o.id
         LEFT JOIN voucher_templates vt ON vt.id = vp.template_id
         WHERE o.created_at >= $1::timestamptz
           AND o.created_at < ($2::date + INTERVAL '1 day')
           AND o.status IN ('paid', 'confirmed', 'completed')
           AND (m.id IS NOT NULL OR vp.id IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id)
           ${filter}
       )
       SELECT item_id, name, kind,
              SUM(qty)::int AS total_quantity,
              COALESCE(SUM(revenue), 0) AS total_revenue
       FROM sold
       GROUP BY item_id, name, kind
       ORDER BY total_revenue DESC
       LIMIT 20`,
      queryParams,
    );

    return result.rows.map((row) => ({
      serviceId: row.item_id,
      name: row.name,
      kind: (row.kind ?? 'service') as ServiceBreakdown['kind'],
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
