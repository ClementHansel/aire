import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { normalizePhone } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * CustomerContextService — the SINGLE guarded gateway through which any WhatsApp
 * agent (rigid or LLM) reads data.
 *
 * SECURITY MODEL:
 *  - The customer is resolved server-side from the inbound WhatsApp phone number.
 *    The resulting customerId is bound here and is NEVER taken from message text
 *    or model output, so an agent can only ever see the asking customer's data.
 *  - Every customer-scoped query filters by BOTH tenant_id and the bound
 *    customer (id or normalized phone). No method returns other customers,
 *    revenue/financials, settlement, payroll, costs, staff, or cross-tenant data.
 *  - Unknown numbers resolve to `null` (prospect) → only public info is exposed.
 */

export interface ResolvedCustomer {
  id: string;
  name: string;
  phone: string;
  normalized: string;
}

export interface CustomerScopedContext {
  memberships: { plan: string; status: string; endDate: string; usesLeft: number | null; plates: string[] }[];
  recentOrders: { orderNumber: string; status: string; total: number; createdAt: string }[];
  activeQueue: { orderNumber: string; position: number; status: string } | null;
  voucherPacks: { quantity: number; redeemed: number; active: number; benefit: string }[];
  bookings: { service: string | null; scheduledAt: string; status: string }[];
}

export interface PublicInfo {
  services: { unit: string; name: string; price: number }[];
  plans: { name: string; price: number; durationMonths: number }[];
  promotions: string[];
}

@Injectable()
export class CustomerContextService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Resolve a WhatsApp number to a customer within the tenant (or null = prospect). */
  async resolveCustomer(tenantId: string, rawPhone: string): Promise<ResolvedCustomer | null> {
    const digits = (rawPhone || '').replace(/@.*/, '');
    const { normalized } = normalizePhone(digits);
    const norm = normalized || digits.replace(/\D/g, '');
    if (!norm) return null;
    const r = await this.pool.query(
      `SELECT id, name, phone, phone_normalized FROM customers
       WHERE tenant_id = $1 AND phone_normalized = $2 LIMIT 1`,
      [tenantId, norm],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, phone: row.phone, normalized: row.phone_normalized };
  }

  /** All data the asking customer is allowed to see — strictly scoped to them. */
  async getCustomerContext(tenantId: string, customer: ResolvedCustomer): Promise<CustomerScopedContext> {
    const [memberships, recentOrders, activeQueue, voucherPacks, bookings] = await Promise.all([
      this.memberships(tenantId, customer.id),
      this.recentOrders(tenantId, customer.id),
      this.activeQueue(tenantId, customer.id),
      this.voucherPacks(tenantId, customer.normalized),
      this.bookings(tenantId, customer.normalized),
    ]);
    return { memberships, recentOrders, activeQueue, voucherPacks, bookings };
  }

  private async memberships(tenantId: string, customerId: string) {
    const r = await this.pool.query(
      `SELECT mp.name AS plan, m.status, m.end_date::text AS end_date,
              GREATEST(m.max_uses - m.uses_count, 0) AS uses_left,
              COALESCE(array_agg(DISTINCT pl.plate) FILTER (WHERE pl.plate IS NOT NULL), '{}') AS plates
       FROM memberships m
       JOIN membership_plans mp ON mp.id = m.plan_id
       LEFT JOIN membership_plates pl ON pl.membership_id = m.id
       WHERE m.tenant_id = $1 AND m.customer_id = $2
       GROUP BY mp.name, m.status, m.end_date, m.max_uses, m.uses_count
       ORDER BY m.end_date DESC LIMIT 5`,
      [tenantId, customerId],
    );
    return r.rows.map((x: any) => ({
      plan: x.plan, status: x.status, endDate: x.end_date,
      usesLeft: x.uses_left == null ? null : Number(x.uses_left),
      plates: x.plates ?? [],
    }));
  }

  private async recentOrders(tenantId: string, customerId: string) {
    const r = await this.pool.query(
      `SELECT order_number, status, total, created_at
       FROM orders WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC LIMIT 5`,
      [tenantId, customerId],
    );
    return r.rows.map((x: any) => ({
      orderNumber: x.order_number, status: x.status, total: Number(x.total),
      createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at,
    }));
  }

  private async activeQueue(tenantId: string, customerId: string) {
    const r = await this.pool.query(
      `SELECT o.order_number, vq.position, vq.status
       FROM vehicle_queue vq JOIN orders o ON o.id = vq.order_id
       WHERE o.tenant_id = $1 AND o.customer_id = $2 AND vq.status IN ('waiting','serving')
       ORDER BY vq.created_at DESC LIMIT 1`,
      [tenantId, customerId],
    );
    const x = r.rows[0];
    return x ? { orderNumber: x.order_number, position: x.position, status: x.status } : null;
  }

  private async voucherPacks(tenantId: string, normalizedPhone: string) {
    const r = await this.pool.query(
      `SELECT b.quantity, b.benefit_type,
              COUNT(t.id) FILTER (WHERE t.status = 'redeemed')::int AS redeemed,
              COUNT(t.id) FILTER (WHERE t.status = 'active')::int AS active
       FROM voucher_books b
       LEFT JOIN voucher_tickets t ON t.book_id = b.id
       WHERE b.tenant_id = $1 AND regexp_replace(COALESCE(b.buyer_phone,''), '[^0-9]', '', 'g') = $2
       GROUP BY b.id, b.quantity, b.benefit_type
       ORDER BY b.created_at DESC LIMIT 10`,
      [tenantId, normalizedPhone],
    );
    return r.rows.map((x: any) => ({ quantity: x.quantity, redeemed: x.redeemed, active: x.active, benefit: x.benefit_type }));
  }

  /** Active (unredeemed) voucher codes for this customer's phone, with expiry. */
  async activeVoucherCodes(tenantId: string, normalizedPhone: string): Promise<{ code: string; expiryDate: string | null }[]> {
    const r = await this.pool.query(
      `SELECT t.code, b.expiry_date::text AS expiry_date
       FROM voucher_tickets t JOIN voucher_books b ON b.id = t.book_id
       WHERE t.tenant_id = $1 AND regexp_replace(COALESCE(b.buyer_phone,''), '[^0-9]', '', 'g') = $2 AND t.status = 'active'
       ORDER BY t.code`,
      [tenantId, normalizedPhone],
    );
    return r.rows.map((x: any) => ({ code: x.code, expiryDate: x.expiry_date ?? null }));
  }

  /** Branch location + opening hours. With outletId: that branch (if active). Without: a short list of active branches. */
  async getBranchInfo(tenantId: string, outletId?: string | null): Promise<
    | { branch: { name: string; address: string | null; timezone: string | null; openingHours: unknown } }
    | { branches: { name: string; address: string | null; openingHours: unknown }[] }
  > {
    if (outletId) {
      const r = await this.pool.query(
        `SELECT name, address, timezone, opening_hours FROM outlets WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
        [outletId, tenantId],
      );
      const b = r.rows[0];
      return {
        branch: b
          ? { name: b.name, address: b.address ?? null, timezone: b.timezone ?? null, openingHours: b.opening_hours ?? null }
          : { name: '', address: null, timezone: null, openingHours: null },
      };
    }
    const r = await this.pool.query(
      `SELECT name, address, opening_hours FROM outlets WHERE tenant_id = $1 AND is_active = true ORDER BY name LIMIT 10`,
      [tenantId],
    );
    return {
      branches: r.rows.map((x: any) => ({ name: x.name, address: x.address ?? null, openingHours: x.opening_hours ?? null })),
    };
  }

  private async bookings(tenantId: string, normalizedPhone: string) {
    const r = await this.pool.query(
      `SELECT service_name, scheduled_at, status FROM bookings
       WHERE tenant_id = $1 AND regexp_replace(COALESCE(customer_phone,''), '[^0-9]', '', 'g') = $2
         AND status IN ('booked','confirmed')
       ORDER BY scheduled_at ASC LIMIT 5`,
      [tenantId, normalizedPhone],
    );
    return r.rows.map((x: any) => ({
      service: x.service_name,
      scheduledAt: x.scheduled_at instanceof Date ? x.scheduled_at.toISOString() : x.scheduled_at,
      status: x.status,
    }));
  }

  /** Public, non-personal info every customer/prospect may see. */
  async getPublicInfo(tenantId: string, outletId?: string | null): Promise<PublicInfo> {
    const svcParams: unknown[] = [tenantId];
    let outletClause = '';
    if (outletId) {
      svcParams.push(outletId);
      outletClause = ` AND (outlet_id = $2 OR (outlet_id IS NULL AND (outlet_ids IS NULL OR outlet_ids = '{}')) OR $2 = ANY(outlet_ids))`;
    }
    const [services, plans, promotions] = await Promise.all([
      this.pool.query(
        `SELECT name, business_unit, price FROM services
         WHERE tenant_id = $1 AND is_active = true${outletClause}
         ORDER BY business_unit, sort_order, name LIMIT 60`,
        svcParams,
      ),
      this.pool.query(
        `SELECT name, price, duration_months FROM membership_plans
         WHERE tenant_id = $1 AND is_active = true ORDER BY price LIMIT 20`,
        [tenantId],
      ),
      this.pool.query(
        `SELECT name FROM promotions
         WHERE tenant_id = $1 AND is_active = true
           AND (start_date IS NULL OR start_date <= CURRENT_DATE)
           AND (end_date IS NULL OR end_date >= CURRENT_DATE)
         ORDER BY created_at DESC LIMIT 10`,
        [tenantId],
      ).catch(() => ({ rows: [] as { name: string }[] })),
    ]);
    return {
      services: services.rows.map((x: any) => ({ unit: x.business_unit, name: x.name, price: Number(x.price) })),
      plans: plans.rows.map((x: any) => ({ name: x.name, price: Number(x.price), durationMonths: x.duration_months })),
      promotions: promotions.rows.map((x: any) => x.name),
    };
  }
}
