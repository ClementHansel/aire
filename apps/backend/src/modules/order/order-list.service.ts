import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  OrderQueryParams,
  OrderCard,
  OrderCardItem,
  OrderListResponse,
  OrderStatus,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@aire/shared';

/**
 * Raw order row from the database join query.
 */
interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  license_plate: string | null;
  vehicle_brand: string | null;
  operator_name: string;
  status: string;
  total: string;
  created_at: string;
}

/**
 * Raw order item row from the order_items join.
 */
interface OrderItemRow {
  order_id: string;
  service_name: string;
  quantity: number;
  subtotal: string;
}

/**
 * Service for listing and filtering orders.
 *
 * Supports:
 * - Status filtering
 * - Text search (order_number, customer_name, customer_phone via ILIKE)
 * - Date range filtering
 * - Tenant scoping (always applied, from params.tenantId)
 * - Outlet filtering (role-resolved set from ScopeService; null = all branches)
 * - Pagination
 *
 * Isolation note: callers reach this only through OrderController, which uses
 * JwtAuthGuard (not RlsContextGuard). Tenant/branch scoping is therefore enforced
 * in buildWhereClause(), NOT by Postgres RLS.
 *
 * Requirements: 20.2, 20.3, 20.4, 20.5, 20.6
 */
@Injectable()
export class OrderListService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * List orders with filtering, searching, and pagination.
   *
   * @param params - Query parameters for filtering
   * @returns Paginated order list response with order cards
   */
  async listOrders(params: OrderQueryParams): Promise<OrderListResponse> {
    const page = Math.max(params.page ?? DEFAULT_PAGE, 1);
    const pageSize = Math.min(
      Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const offset = (page - 1) * pageSize;

    const { whereClause, queryParams } = this.buildWhereClause(params);

    // Count total matching orders
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM orders o
      ${whereClause}
    `;
    const countResult = await this.pool.query<{ total: number }>(
      countQuery,
      queryParams,
    );
    const total = countResult.rows[0]?.total ?? 0;

    if (total === 0) {
      return { orders: [], total: 0, page, pageSize, hasMore: false };
    }

    // Fetch paginated orders with operator name
    const paramIndex = queryParams.length;
    const ordersQuery = `
      SELECT
        o.id,
        o.order_number,
        o.customer_name,
        o.customer_phone,
        o.license_plate,
        o.vehicle_brand,
        u.name AS operator_name,
        o.status,
        o.total::text,
        o.created_at::text
      FROM orders o
      JOIN users u ON o.operator_id = u.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
    `;
    const ordersResult = await this.pool.query<OrderRow>(ordersQuery, [
      ...queryParams,
      pageSize,
      offset,
    ]);

    const orderIds = ordersResult.rows.map((r) => r.id);

    // Fetch items for all orders in one batch
    let itemsByOrder: Record<string, OrderCardItem[]> = {};
    if (orderIds.length > 0) {
      const itemsQuery = `
        SELECT
          oi.order_id,
          s.name AS service_name,
          oi.quantity,
          oi.subtotal::text
        FROM order_items oi
        JOIN services s ON oi.service_id = s.id
        WHERE oi.order_id = ANY($1)
        ORDER BY oi.sort_order ASC
      `;
      const itemsResult = await this.pool.query<OrderItemRow>(itemsQuery, [
        orderIds,
      ]);
      itemsByOrder = this.groupItemsByOrder(itemsResult.rows);
    }

    // Build order cards
    const orders: OrderCard[] = ordersResult.rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      licensePlate: row.license_plate ?? undefined,
      vehicleBrand: row.vehicle_brand ?? undefined,
      operatorName: row.operator_name,
      status: row.status as OrderStatus,
      items: itemsByOrder[row.id] ?? [],
      total: parseFloat(row.total),
      createdAt: row.created_at,
    }));

    const hasMore = offset + orders.length < total;

    return { orders, total, page, pageSize, hasMore };
  }

  /**
   * Build the WHERE clause dynamically based on the provided query params.
   */
  private buildWhereClause(params: OrderQueryParams): {
    whereClause: string;
    queryParams: unknown[];
  } {
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let paramIdx = 1;

    // Tenant scope — ALWAYS applied. This endpoint uses only JwtAuthGuard (no
    // RlsContextGuard), so tenant isolation is enforced here explicitly rather
    // than by Postgres RLS. Without this, an owner/super-admin with no outletId
    // filter would list across tenants.
    conditions.push(`o.tenant_id = $${paramIdx}`);
    queryParams.push(params.tenantId);
    paramIdx++;

    // Status filter
    if (params.status) {
      conditions.push(`o.status = $${paramIdx}`);
      queryParams.push(params.status);
      paramIdx++;
    }

    // Search filter (ILIKE on order_number, customer_name, customer_phone)
    if (params.search && params.search.trim().length > 0) {
      const searchPattern = `%${params.search.trim()}%`;
      conditions.push(
        `(o.order_number ILIKE $${paramIdx} OR o.customer_name ILIKE $${paramIdx} OR o.customer_phone ILIKE $${paramIdx})`,
      );
      queryParams.push(searchPattern);
      paramIdx++;
    }

    // Date range - from
    if (params.dateFrom) {
      conditions.push(`o.created_at >= $${paramIdx}::timestamptz`);
      queryParams.push(params.dateFrom);
      paramIdx++;
    }

    // Date range - to
    if (params.dateTo) {
      conditions.push(`o.created_at < ($${paramIdx}::date + interval '1 day')`);
      queryParams.push(params.dateTo);
      paramIdx++;
    }

    // Branch filter (role-resolved set). null/undefined = all branches; [] = none.
    if (params.outletIds != null) {
      conditions.push(`o.outlet_id = ANY($${paramIdx}::uuid[])`);
      queryParams.push(params.outletIds);
      paramIdx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return { whereClause, queryParams };
  }

  /**
   * Group order item rows by order_id into a map.
   */
  private groupItemsByOrder(rows: OrderItemRow[]): Record<string, OrderCardItem[]> {
    const map: Record<string, OrderCardItem[]> = {};
    for (const row of rows) {
      if (!map[row.order_id]) {
        map[row.order_id] = [];
      }
      map[row.order_id]!.push({
        serviceName: row.service_name,
        quantity: row.quantity,
        subtotal: parseFloat(row.subtotal),
      });
    }
    return map;
  }
}
