import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { normalizePhone, normalizePlate } from '@aire/shared';
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

  /**
   * Per-category "what may the customer AI reveal" flags (agent_configs.customer_knowledge).
   * Missing key = visible (backward compatible); only an explicit `false` hides a category.
   * Gating lives HERE, in the single data gateway, so every surface (built-in agent,
   * rigid templates, and the n8n bridge) honors the tenant's choices identically.
   */
  async getKnowledgeFlags(tenantId: string): Promise<Record<string, boolean>> {
    const r = await this.pool.query<{ customer_knowledge: Record<string, boolean> | null }>(
      `SELECT customer_knowledge FROM agent_configs WHERE tenant_id = $1`,
      [tenantId],
    );
    return r.rows[0]?.customer_knowledge ?? {};
  }
  private catOn(flags: Record<string, boolean>, key: string): boolean {
    return flags[key] !== false;
  }

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

  /** Load a customer by id (used when a conversation is already bound to one). */
  async resolveById(tenantId: string, customerId: string): Promise<ResolvedCustomer | null> {
    const r = await this.pool.query(
      `SELECT id, name, phone, phone_normalized FROM customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, customerId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, phone: row.phone, normalized: row.phone_normalized };
  }

  /**
   * Try to identify a customer from what they typed — an Indonesian phone number,
   * a 8–14 char membership number, or a license plate. Used to bind a customer to
   * a chat when the WhatsApp address itself is a privacy id (@lid) with no number.
   * Returns the first match (phone → membership number → plate), or null.
   */
  async resolveIdentityFromText(tenantId: string, text: string): Promise<ResolvedCustomer | null> {
    const raw = text || '';

    // 1) Phone number (0…, 62…, +62…).
    const phoneTok = raw.match(/(?:\+?62|0)\d[\d\s-]{7,14}\d/);
    if (phoneTok) {
      const byPhone = await this.resolveCustomer(tenantId, phoneTok[0]);
      if (byPhone) return byPhone;
    }

    // 2) Membership number (customers.membership_number / customer_code) — an
    //    uppercase alphanumeric token, typically ~12 chars.
    const codeToks = raw.toUpperCase().match(/\b[A-Z0-9]{8,14}\b/g) ?? [];
    for (const code of codeToks) {
      const r = await this.pool.query(
        `SELECT id, name, phone, phone_normalized FROM customers
         WHERE tenant_id = $1 AND (upper(membership_number) = $2 OR upper(customer_code) = $2) LIMIT 1`,
        [tenantId, code],
      );
      const row = r.rows[0];
      if (row) return { id: row.id, name: row.name, phone: row.phone, normalized: row.phone_normalized };
    }

    // 3) License plate → the membership's customer.
    const plateTok = raw.toUpperCase().match(/\b[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}\b/g) ?? [];
    for (const p of plateTok) {
      const { normalized: plateNorm } = normalizePlate(p);
      if (!plateNorm || plateNorm.length < 4) continue;
      const r = await this.pool.query(
        `SELECT c.id, c.name, c.phone, c.phone_normalized
         FROM membership_plates pl
         JOIN memberships m ON m.id = pl.membership_id
         JOIN customers c ON c.id = m.customer_id
         WHERE m.tenant_id = $1 AND pl.plate_normalized = $2
         ORDER BY m.end_date DESC LIMIT 1`,
        [tenantId, plateNorm],
      );
      const row = r.rows[0];
      if (row) return { id: row.id, name: row.name, phone: row.phone, normalized: row.phone_normalized };
    }

    return null;
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
    // Gated by the 'vouchers' category flag.
    const flags = await this.getKnowledgeFlags(tenantId);
    if (!this.catOn(flags, 'vouchers')) return [];
    const r = await this.pool.query(
      `SELECT t.code, b.expiry_date::text AS expiry_date
       FROM voucher_tickets t JOIN voucher_books b ON b.id = t.book_id
       WHERE t.tenant_id = $1 AND regexp_replace(COALESCE(b.buyer_phone,''), '[^0-9]', '', 'g') = $2 AND t.status = 'active'
       ORDER BY t.code`,
      [tenantId, normalizedPhone],
    );
    return r.rows.map((x: any) => ({ code: x.code, expiryDate: x.expiry_date ?? null }));
  }

  /** Branch location + hours + contact. Gated by the branches/opening_hours/branch_contact
   *  category flags and per-outlet customer_visible. With outletId: that branch. Without: a list. */
  async getBranchInfo(tenantId: string, outletId?: string | null): Promise<
    | { branch: { name: string; address: string | null; timezone: string | null; openingHours: unknown; phone: string | null; mapsUrl: string | null } | null }
    | { branches: { name: string; address: string | null; openingHours: unknown; phone: string | null; mapsUrl: string | null }[]; note?: string }
  > {
    const flags = await this.getKnowledgeFlags(tenantId);
    if (!this.catOn(flags, 'branches')) {
      return { branches: [], note: 'Branch info is not shared here — please ask our team.' };
    }
    const showHours = this.catOn(flags, 'opening_hours');
    const showContact = this.catOn(flags, 'branch_contact');
    const shape = (b: any) => ({
      name: b.name,
      address: b.address ?? null,
      openingHours: showHours ? (b.opening_hours ?? null) : null,
      phone: showContact ? (b.phone ?? null) : null,
      mapsUrl: showContact ? (b.maps_url ?? null) : null,
    });
    if (outletId) {
      const r = await this.pool.query(
        `SELECT name, address, timezone, opening_hours, phone, maps_url FROM outlets
         WHERE id = $1 AND tenant_id = $2 AND is_active = true AND customer_visible = true`,
        [outletId, tenantId],
      );
      const b = r.rows[0];
      return { branch: b ? { timezone: b.timezone ?? null, ...shape(b) } : null };
    }
    const r = await this.pool.query(
      `SELECT name, address, opening_hours, phone, maps_url FROM outlets
       WHERE tenant_id = $1 AND is_active = true AND customer_visible = true ORDER BY name LIMIT 10`,
      [tenantId],
    );
    return { branches: r.rows.map(shape) };
  }

  /**
   * Branch availability for booking: opening hours + the times already booked on
   * the requested day + the live queue length right now. NON-personal — aggregate
   * counts and booked slot times only, never other customers' identities — so any
   * persona may call it. `dateStr` is YYYY-MM-DD; invalid/absent → today.
   */
  async getAvailability(tenantId: string, outletId: string | null, dateStr: string | null): Promise<{
    date: string;
    branch: string | null;
    openingHours: unknown;
    bookedTimes: string[];
    existingBookings: number;
    liveQueue: number;
    note: string;
  }> {
    // Resolve the target branch: the one given, else the sole active branch (if
    // there's exactly one) so a single-outlet tenant "just works".
    let targetOutlet = outletId;
    let branchName: string | null = null;
    let openingHours: unknown = null;
    if (targetOutlet) {
      const r = await this.pool.query(
        `SELECT name, opening_hours FROM outlets WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
        [targetOutlet, tenantId],
      );
      if (r.rows[0]) { branchName = r.rows[0].name; openingHours = r.rows[0].opening_hours ?? null; }
    } else {
      const r = await this.pool.query(
        `SELECT id, name, opening_hours FROM outlets WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
        [tenantId],
      );
      if (r.rows.length === 1) {
        targetOutlet = r.rows[0].id; branchName = r.rows[0].name; openingHours = r.rows[0].opening_hours ?? null;
      }
    }

    const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);

    // Booked slot times on that date (all customers, but only the HH:MM — no identity).
    const bParams: unknown[] = [tenantId, date];
    let bOutlet = '';
    if (targetOutlet) { bParams.push(targetOutlet); bOutlet = ' AND outlet_id = $3'; }
    const b = await this.pool.query(
      `SELECT to_char(scheduled_at, 'HH24:MI') AS hm FROM bookings
       WHERE tenant_id = $1 AND scheduled_at::date = $2::date AND status IN ('booked','confirmed')${bOutlet}
       ORDER BY scheduled_at`,
      bParams,
    );
    const bookedTimes = b.rows.map((x: any) => x.hm);

    // How busy right now: vehicles currently waiting or being served.
    const qParams: unknown[] = [tenantId];
    let qOutlet = '';
    if (targetOutlet) { qParams.push(targetOutlet); qOutlet = ' AND o.outlet_id = $2'; }
    const q = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM vehicle_queue vq JOIN orders o ON o.id = vq.order_id
       WHERE o.tenant_id = $1 AND vq.status IN ('waiting','serving')${qOutlet}`,
      qParams,
    );
    const liveQueue = q.rows[0]?.n ?? 0;

    const note = openingHours
      ? 'Cek openingHours untuk memastikan cabang buka pada jam yang diminta, lalu bandingkan dengan bookedTimes.'
      : 'Jam buka belum diatur di sistem — anggap jam operasional normal dan konfirmasikan ke pelanggan.';
    return { date, branch: branchName, openingHours, bookedTimes, existingBookings: bookedTimes.length, liveQueue, note };
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
    const flags = await this.getKnowledgeFlags(tenantId);
    const svcParams: unknown[] = [tenantId];
    let outletClause = '';
    if (outletId) {
      svcParams.push(outletId);
      outletClause = ` AND (outlet_id = $2 OR (outlet_id IS NULL AND (outlet_ids IS NULL OR outlet_ids = '{}')) OR $2 = ANY(outlet_ids))`;
    }
    // Each category is gated by the tenant's customer_knowledge flag; within an
    // enabled category, per-item customer_visible hides individual rows.
    const empty = { rows: [] as any[] };
    const [services, plans, promotions] = await Promise.all([
      this.catOn(flags, 'service_prices') ? this.pool.query(
        `SELECT name, business_unit, price FROM services
         WHERE tenant_id = $1 AND is_active = true AND customer_visible = true${outletClause}
         ORDER BY business_unit, sort_order, name LIMIT 60`,
        svcParams,
      ) : Promise.resolve(empty),
      this.catOn(flags, 'membership_plans') ? this.pool.query(
        `SELECT name, price, duration_months FROM membership_plans
         WHERE tenant_id = $1 AND is_active = true AND customer_visible = true ORDER BY price LIMIT 20`,
        [tenantId],
      ) : Promise.resolve(empty),
      this.catOn(flags, 'promotions') ? this.pool.query(
        `SELECT name FROM promotions
         WHERE tenant_id = $1 AND is_active = true AND customer_visible = true
           AND (start_date IS NULL OR start_date <= CURRENT_DATE)
           AND (end_date IS NULL OR end_date >= CURRENT_DATE)
         ORDER BY created_at DESC LIMIT 10`,
        [tenantId],
      ).catch(() => empty) : Promise.resolve(empty),
    ]);
    return {
      services: services.rows.map((x: any) => ({ unit: x.business_unit, name: x.name, price: Number(x.price) })),
      plans: plans.rows.map((x: any) => ({ name: x.name, price: Number(x.price), durationMonths: x.duration_months })),
      promotions: promotions.rows.map((x: any) => x.name),
    };
  }
}
