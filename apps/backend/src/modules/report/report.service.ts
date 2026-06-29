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
    const { dateFrom, dateTo, outletId } = params;

    const [
      overviewResult,
      paymentMethodResult,
      serviceResult,
    ] = await Promise.all([
      this.getOverviewStats(dateFrom, dateTo, outletId),
      this.getPaymentMethodBreakdown(dateFrom, dateTo, outletId),
      this.getServiceBreakdown(dateFrom, dateTo, outletId),
    ]);

    return {
      ...overviewResult,
      byPaymentMethod: paymentMethodResult,
      byService: serviceResult,
    };
  }

  /**
   * Generates CSV content for orders in the given date range.
   * Returns CSV string with headers: Order Number, Date, Customer, Phone, Status,
   * Payment Method, Total, Items, Note
   */
  async exportCsv(params: ReportQueryParams): Promise<string> {
    const { dateFrom, dateTo, outletId } = params;

    const queryParams: (string | undefined)[] = [dateFrom, dateTo];
    let outletFilter = '';
    if (outletId) {
      outletFilter = ' AND o.outlet_id = $3';
      queryParams.push(outletId);
    }

    const result = await this.pool.query<{
      order_number: string;
      created_at: Date;
      customer_name: string;
      customer_phone: string;
      status: string;
      payment_method: string | null;
      total: string;
      note: string | null;
      items: string;
    }>(
      `SELECT
        o.order_number,
        o.created_at,
        o.customer_name,
        o.customer_phone,
        o.status,
        o.payment_method,
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
         ${outletFilter}
       GROUP BY o.id, o.order_number, o.created_at, o.customer_name,
                o.customer_phone, o.status, o.payment_method, o.total, o.note
       ORDER BY o.created_at ASC`,
      queryParams.filter((p) => p !== undefined),
    );

    const headers = [
      'Order Number',
      'Date',
      'Customer',
      'Phone',
      'Status',
      'Payment Method',
      'Total',
      'Items',
      'Note',
    ];

    const rows = result.rows.map((row) => [
      this.escapeCsv(row.order_number),
      this.escapeCsv(new Date(row.created_at).toISOString()),
      this.escapeCsv(row.customer_name),
      this.escapeCsv(row.customer_phone),
      this.escapeCsv(row.status),
      this.escapeCsv(row.payment_method ?? ''),
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
  ): Promise<Omit<SummaryResponse, 'byPaymentMethod' | 'byService'>> {
    const queryParams: string[] = [dateFrom, dateTo];
    let outletFilter = '';
    if (outletId) {
      outletFilter = ' AND outlet_id = $3';
      queryParams.push(outletId);
    }

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
         ${outletFilter}`,
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
  ): Promise<Record<string, PaymentMethodBreakdown>> {
    const queryParams: string[] = [dateFrom, dateTo];
    let outletFilter = '';
    if (outletId) {
      outletFilter = ' AND outlet_id = $3';
      queryParams.push(outletId);
    }

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
         ${outletFilter}
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

  private async getServiceBreakdown(
    dateFrom: string,
    dateTo: string,
    outletId?: string,
  ): Promise<ServiceBreakdown[]> {
    const queryParams: string[] = [dateFrom, dateTo];
    let outletFilter = '';
    if (outletId) {
      outletFilter = ' AND o.outlet_id = $3';
      queryParams.push(outletId);
    }

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
         ${outletFilter}
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
