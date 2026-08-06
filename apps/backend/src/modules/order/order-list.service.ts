import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  OrderQueryParams,
  OrderCard,
  OrderCardItem,
  OrderDiscountSource,
  OrderListResponse,
  OrderStatus,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePlate,
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
  subtotal?: string;
  service_charge?: string;
  tax?: string;
  voucher_discount?: string;
  promo_discount?: string;
  payment_method?: string | null;
  is_member?: boolean;
}

/**
 * Raw order item row from the order_items join.
 */
interface OrderItemRow {
  order_id: string;
  service_id: string | null;
  service_name: string;
  item_type: string | null;
  quantity: number;
  subtotal: string;
  is_member_pricing: boolean | null;
  member_discount_type: string | null;
  member_discount_value: string | null;
  discount: string | null;
}

/** One reason money came off an order: a promotion, or a redeemed voucher. */
interface DiscountSourceRow {
  order_id: string;
  kind: 'promo' | 'voucher' | 'campaign';
  label: string;
  amount: string | null;
  covers_service_id: string | null;
  via_campaign: string | null;
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
        o.created_at::text,
        o.subtotal::text,
        o.service_charge::text,
        o.tax::text,
        o.voucher_discount::text,
        o.promo_discount::text,
        o.payment_method,
        (o.membership_id IS NOT NULL) AS is_member
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
    let sourcesByOrder: Record<string, OrderDiscountSource[]> = {};
    if (orderIds.length > 0) {
      // LEFT JOIN + COALESCE, not an inner JOIN on service_id: a membership-plan
      // or voucher-pack line has service_id NULL (migration 089) and an inner
      // join dropped it from the card entirely, so an order that WAS a membership
      // or pack purchase listed no items at all and the cashier could not tell
      // which plan/pack had been sold (AIRIN-115). item_name carries the plan or
      // template name, and item_type says which kind it is.
      const itemsQuery = `
        SELECT
          oi.order_id,
          oi.service_id,
          COALESCE(s.name, oi.item_name) AS service_name,
          oi.item_type,
          oi.quantity,
          oi.subtotal::text,
          -- Why a line is cheap or free. A Rp 0 wash next to a full-price add-on
          -- gave no clue whether a membership covered it, a voucher did, or the
          -- cashier discounted it; is_member_pricing has always been recorded, it
          -- was simply never surfaced (Samuel 2026-08-06).
          oi.is_member_pricing,
          oi.member_discount_type,
          oi.member_discount_value::text,
          oi.discount::text
        FROM order_items oi
        LEFT JOIN services s ON oi.service_id = s.id
        WHERE oi.order_id = ANY($1)
        ORDER BY oi.sort_order ASC
      `;
      const itemsResult = await this.pool.query<OrderItemRow>(itemsQuery, [
        orderIds,
      ]);
      itemsByOrder = this.groupItemsByOrder(itemsResult.rows);
      sourcesByOrder = await this.loadDiscountSources(orderIds);
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
      subtotal: row.subtotal != null ? parseFloat(row.subtotal) : 0,
      serviceCharge: row.service_charge != null ? parseFloat(row.service_charge) : 0,
      tax: row.tax != null ? parseFloat(row.tax) : 0,
      voucherDiscount: row.voucher_discount != null ? parseFloat(row.voucher_discount) : 0,
      promoDiscount: row.promo_discount != null ? parseFloat(row.promo_discount) : 0,
      paymentMethod: row.payment_method ?? null,
      isMember: row.is_member === true,
      total: parseFloat(row.total),
      createdAt: row.created_at,
      discountSources: sourcesByOrder[row.id] ?? [],
    }));

    const hasMore = offset + orders.length < total;

    return { orders, total, page, pageSize, hasMore };
  }

  /**
   * Which promotions and vouchers took money off these orders.
   *
   * Both are recorded per order already — `promotion_grants` for promotions and
   * `voucher_tickets.redeemed_order_id` / `voucher_codes` for vouchers — they were
   * simply never read back, so a discounted line was unexplained: a membership, a
   * voucher and a promo all just showed a smaller number (Samuel 2026-08-06). A
   * service-typed voucher also reports which service it covered, which is what
   * lets the UI tag the exact line rather than the whole order.
   */
  private async loadDiscountSources(orderIds: string[]): Promise<Record<string, OrderDiscountSource[]>> {
    const res = await this.pool.query<DiscountSourceRow>(
      `SELECT pg.order_id, 'promo' AS kind, p.name AS label,
              pg.amount::text AS amount, NULL::uuid AS covers_service_id,
              NULL::text AS via_campaign
         FROM promotion_grants pg
         JOIN promotions p ON p.id = pg.promotion_id
        WHERE pg.order_id = ANY($1)
       UNION ALL
       -- Plaintext book tickets (the current model). The LEFT JOIN back through
       -- campaign_grants answers "where did the customer get this voucher?" — a
       -- bonus code is only meaningful once you know which campaign granted it.
       SELECT t.redeemed_order_id AS order_id, 'voucher' AS kind,
              COALESCE(vt.name, bs.name, b.benefit_type) || ' (' || t.code || ')' AS label,
              NULL AS amount, b.benefit_service_id AS covers_service_id,
              gc.name AS via_campaign
         FROM voucher_tickets t
         JOIN voucher_books b ON b.id = t.book_id
         LEFT JOIN voucher_templates vt ON vt.id = b.template_id
         LEFT JOIN services bs ON bs.id = b.benefit_service_id
         LEFT JOIN campaign_grants cg ON cg.voucher_book_id = b.id
         LEFT JOIN campaigns gc ON gc.id = cg.campaign_id
        WHERE t.redeemed_order_id = ANY($1)
       UNION ALL
       -- Legacy hashed pack codes: the code itself was never stored in plaintext,
       -- so the template name is all we can name it by. Note the column here is
       -- order_id: only the newer voucher_tickets calls it redeemed_order_id.
       SELECT vc.order_id AS order_id, 'voucher' AS kind,
              vt2.name AS label, NULL AS amount, NULL::uuid AS covers_service_id,
              gc2.name AS via_campaign
         FROM voucher_codes vc
         JOIN voucher_packs vp ON vp.id = vc.pack_id
         JOIN voucher_templates vt2 ON vt2.id = vp.template_id
         LEFT JOIN campaign_grants cg2 ON cg2.voucher_pack_id = vp.id
         LEFT JOIN campaigns gc2 ON gc2.id = cg2.campaign_id
        WHERE vc.order_id = ANY($1)
       UNION ALL
       -- A campaign that FIRED on this order: the purchase itself earned a bonus.
       -- This is the other direction from the arms above — not money off today's
       -- bill, but what this transaction triggered, which is otherwise invisible
       -- on the order that caused it.
       SELECT cg3.order_id, 'campaign' AS kind,
              c3.name || COALESCE(' -> ' || vt3.name, '') AS label,
              NULL AS amount, NULL::uuid AS covers_service_id,
              c3.name AS via_campaign
         FROM campaign_grants cg3
         JOIN campaigns c3 ON c3.id = cg3.campaign_id
         LEFT JOIN voucher_templates vt3 ON vt3.id = c3.bonus_template_id
        WHERE cg3.order_id = ANY($1)`,
      [orderIds],
    );

    const map: Record<string, OrderDiscountSource[]> = {};
    for (const r of res.rows) {
      if (!r.order_id) continue;
      (map[r.order_id] ??= []).push({
        kind: r.kind,
        label: r.label,
        amount: r.amount != null ? parseFloat(r.amount) : null,
        coversServiceId: r.covers_service_id ?? null,
        viaCampaign: r.via_campaign ?? null,
      });
    }
    return map;
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

    // Search filter (ILIKE on order_number, customer_name, customer_phone, plate)
    if (params.search && params.search.trim().length > 0) {
      const term = params.search.trim();
      const searchPattern = `%${term}%`;
      // Plate matching goes through plate_normalized so spacing is irrelevant:
      // "B 8882 CST", "b8882cst" and "B8882 CST" all find the same order
      // (AIRIN-117). Falls back to a raw ILIKE on license_plate so orders
      // predating the backfill are still findable.
      const platePattern = `%${normalizePlate(term).normalized}%`;
      conditions.push(
        `(o.order_number ILIKE $${paramIdx} OR o.customer_name ILIKE $${paramIdx} OR o.customer_phone ILIKE $${paramIdx}
          OR o.plate_normalized ILIKE $${paramIdx + 1} OR o.license_plate ILIKE $${paramIdx})`,
      );
      queryParams.push(searchPattern, platePattern);
      paramIdx += 2;
    }

    // Payment-method filter. Filtered here rather than client-side so `total`
    // and the pager stay consistent with what the table shows.
    if (params.paymentMethod) {
      conditions.push(`o.payment_method = $${paramIdx}`);
      queryParams.push(params.paymentMethod);
      paramIdx++;
    }

    // Member / non-member filter — per-order (membership attached at checkout).
    if (params.memberFilter === 'member') {
      conditions.push(`o.membership_id IS NOT NULL`);
    } else if (params.memberFilter === 'non_member') {
      conditions.push(`o.membership_id IS NULL`);
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
    // An operator always sees their OWN orders even when the shift booked them to
    // a branch outside their assigned set (AIRIN-110) — a row-level exception, so
    // it grants "orders I rang up" and not the rest of that branch's data.
    if (params.outletIds != null) {
      if (params.alwaysVisibleOperatorId) {
        conditions.push(
          `(o.outlet_id = ANY($${paramIdx}::uuid[]) OR o.operator_id = $${paramIdx + 1})`,
        );
        queryParams.push(params.outletIds, params.alwaysVisibleOperatorId);
        paramIdx += 2;
      } else {
        conditions.push(`o.outlet_id = ANY($${paramIdx}::uuid[])`);
        queryParams.push(params.outletIds);
        paramIdx++;
      }
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
        serviceId: row.service_id ?? null,
        serviceName: row.service_name,
        quantity: row.quantity,
        subtotal: parseFloat(row.subtotal),
        itemType: row.item_type ?? null,
        isMemberPricing: row.is_member_pricing === true,
        memberDiscountType: row.member_discount_type ?? null,
        memberDiscountValue: row.member_discount_value != null ? parseFloat(row.member_discount_value) : null,
        discount: row.discount != null ? parseFloat(row.discount) : 0,
      });
    }
    return map;
  }
}
