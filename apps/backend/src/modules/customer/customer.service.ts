import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { MembershipStatus } from '@aire/shared';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Customer profile with visit history, membership status, and preferences.
 * Requirements: 34.1
 */
export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  totalVisits: number;
  totalSpending: number;
  lastVisitDate: string | null;
  memberships: CustomerMembershipInfo[];
  recentVisits: CustomerVisit[];
  servicePreferences: ServicePreference[];
  voucherUsage: VoucherUsageSummary;
  /**
   * Every voucher registered to this customer — bought or granted — with the
   * code, what it is worth and whether it is still spendable (AIRIN-167). The
   * profile previously reported only a redeemed COUNT, so the one question the
   * counter actually asks ("what does this customer still have?") had no answer
   * anywhere in the dashboard.
   */
  vouchers: CustomerVoucher[];
}

export interface CustomerVoucher {
  id: string;
  /** Plaintext code for a book ticket; a pack prefix for the legacy hashed model. */
  code: string;
  type: string;
  value: number;
  expiresAt: string | null;
  status: 'active' | 'used' | 'expired';
  source: 'purchase' | 'campaign';
}

export interface CustomerMembershipInfo {
  id: string;
  planName: string;
  status: string;
  startDate: string;
  endDate: string;
  usesCount: number;
  maxUses: number;
}

export interface CustomerVisit {
  orderId: string;
  orderNumber: string;
  outletName: string;
  date: string;
  total: number;
  services: string[];
  paymentMethod: string | null;
}

export interface ServicePreference {
  serviceId: string;
  serviceName: string;
  timesUsed: number;
  totalSpent: number;
}

export interface VoucherUsageSummary {
  totalRedeemed: number;
  totalSaved: number;
}

/**
 * Customer analytics: visit frequency, spending patterns, service preferences.
 * Requirements: 34.1, 34.2
 */
export interface CustomerAnalytics {
  customerId: string;
  visitFrequency: VisitFrequency;
  spendingPatterns: SpendingPatterns;
  servicePreferences: ServicePreference[];
  segmentation: CustomerSegmentation;
}

export interface VisitFrequency {
  totalVisits: number;
  visitsLast30Days: number;
  visitsLast90Days: number;
  averageDaysBetweenVisits: number | null;
}

export interface SpendingPatterns {
  totalSpending: number;
  averageOrderValue: number;
  spendingLast30Days: number;
  spendingLast90Days: number;
  highestOrder: number;
}

export interface CustomerSegmentation {
  frequencyTier: 'high' | 'medium' | 'low' | 'inactive';
  spendTier: 'vip' | 'high' | 'medium' | 'low';
  membershipStatus: 'active_member' | 'expired_member' | 'non_member';
  recency: 'recent' | 'lapsing' | 'dormant';
}

/**
 * Customer search result
 */
export interface CustomerSearchResult {
  id: string;
  name: string;
  phone: string;
  membershipStatus: string | null;
  totalVisits: number;
  lastVisitDate: string | null;
}

/**
 * Service for customer CRM profiles and analytics.
 *
 * Provides:
 * - Full customer profile with visit history, membership status, preferences
 * - Analytics: visit frequency, spending patterns, service preferences
 * - Customer search functionality
 *
 * Requirements: 34.1, 34.2, 34.3
 */
@Injectable()
export class CustomerService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Get full customer profile with visit history, membership status, and preferences.
   * Aggregates data across all outlets within the tenant (tenant scoping via RLS).
   *
   * Requirements: 34.1
   */
  async getProfile(tenantId: string, customerId: string): Promise<CustomerProfile> {
    // Fetch customer base info — tenant-scoped so a customer id from another
    // tenant cannot be read (returns 404 rather than leaking PII).
    const customerResult = await this.pool.query<{
      id: string;
      name: string;
      phone: string;
      created_at: string;
    }>(
      `SELECT id, name, phone, created_at::text FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
    );

    if (customerResult.rows.length === 0) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const customer = customerResult.rows[0]!;

    // Fetch visit summary
    const visitSummaryResult = await this.pool.query<{
      total_visits: number;
      total_spending: string;
      last_visit_date: string | null;
    }>(
      `SELECT
        COUNT(*)::int AS total_visits,
        COALESCE(SUM(total), 0)::text AS total_spending,
        MAX(created_at)::text AS last_visit_date
      FROM orders
      WHERE customer_id = $1 AND status != 'cancelled'`,
      [customerId],
    );

    const visitSummary = visitSummaryResult.rows[0]!;

    // Fetch memberships
    const membershipsResult = await this.pool.query<{
      id: string;
      plan_name: string;
      status: string;
      start_date: string;
      end_date: string;
      uses_count: number;
      max_uses: number;
    }>(
      `SELECT
        m.id,
        mp.name AS plan_name,
        m.status,
        m.start_date::text,
        m.end_date::text,
        m.uses_count,
        m.max_uses
      FROM memberships m
      JOIN membership_plans mp ON m.plan_id = mp.id
      WHERE m.customer_id = $1
      ORDER BY m.created_at DESC`,
      [customerId],
    );

    // Fetch recent visits (last 10 orders)
    const recentVisitsResult = await this.pool.query<{
      order_id: string;
      order_number: string;
      outlet_name: string;
      date: string;
      total: string;
      payment_method: string | null;
    }>(
      `SELECT
        o.id AS order_id,
        o.order_number,
        out.name AS outlet_name,
        o.created_at::text AS date,
        o.total::text,
        o.payment_method
      FROM orders o
      JOIN outlets out ON o.outlet_id = out.id
      WHERE o.customer_id = $1 AND o.status != 'cancelled'
      ORDER BY o.created_at DESC
      LIMIT 10`,
      [customerId],
    );

    // Fetch services for recent orders
    const orderIds = recentVisitsResult.rows.map((r) => r.order_id);
    let servicesByOrder: Record<string, string[]> = {};
    if (orderIds.length > 0) {
      const servicesResult = await this.pool.query<{
        order_id: string;
        service_name: string;
      }>(
        `SELECT oi.order_id, s.name AS service_name
        FROM order_items oi
        JOIN services s ON oi.service_id = s.id
        WHERE oi.order_id = ANY($1)`,
        [orderIds],
      );
      servicesByOrder = servicesResult.rows.reduce(
        (acc, row) => {
          if (!acc[row.order_id]) acc[row.order_id] = [];
          acc[row.order_id]!.push(row.service_name);
          return acc;
        },
        {} as Record<string, string[]>,
      );
    }

    // Fetch service preferences (top services by usage)
    const servicePrefsResult = await this.pool.query<{
      service_id: string;
      service_name: string;
      times_used: number;
      total_spent: string;
    }>(
      `SELECT
        s.id AS service_id,
        s.name AS service_name,
        SUM(oi.quantity)::int AS times_used,
        SUM(oi.subtotal)::text AS total_spent
      FROM order_items oi
      JOIN services s ON oi.service_id = s.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = $1 AND o.status != 'cancelled'
      GROUP BY s.id, s.name
      ORDER BY times_used DESC
      LIMIT 10`,
      [customerId],
    );

    // Fetch voucher usage summary
    const voucherResult = await this.pool.query<{
      total_redeemed: number;
      total_saved: string;
    }>(
      `SELECT
        COUNT(*)::int AS total_redeemed,
        COALESCE(SUM(o.voucher_discount), 0)::text AS total_saved
      FROM orders o
      WHERE o.customer_id = $1 AND o.status != 'cancelled' AND o.voucher_discount > 0`,
      [customerId],
    );

    const voucher = voucherResult.rows[0]!;

    // Every voucher TICKET this customer holds (AIRIN-167).
    //
    // A ticket belongs to a customer two ways, and both count: the book was
    // minted by an order they paid for (a pack they bought), or a campaign
    // granted it to them directly. EXISTS rather than joins, so a book that is
    // both — a purchase that also triggered a bonus — cannot list its tickets
    // twice.
    //
    // Deliberately books only: the legacy voucher_packs model stores SHA-256
    // hashes, so there is no code to show — printing a prefix would look like a
    // redeemable code that isn't one.
    const ticketsResult = await this.pool.query<{
      id: string; code: string; benefit_type: string; benefit_value: string;
      expiry_date: string | null; status: string; source: string;
    }>(
      `SELECT t.id, t.code, b.benefit_type, b.benefit_value::text AS benefit_value,
              COALESCE(t.expiry_date, b.expiry_date)::text AS expiry_date,
              t.status, b.source
         FROM voucher_tickets t
         JOIN voucher_books b ON b.id = t.book_id
        WHERE b.tenant_id = $1
          AND (
            EXISTS (SELECT 1 FROM orders o WHERE o.id = b.order_id AND o.customer_id = $2)
            OR EXISTS (SELECT 1 FROM campaign_grants cg WHERE cg.voucher_book_id = b.id AND cg.customer_id = $2)
          )
          AND t.status <> 'void'
        ORDER BY (t.status = 'active') DESC, t.created_at DESC
        LIMIT 100`,
      [tenantId, customerId],
    );

    const today = new Date().toISOString().slice(0, 10);

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      createdAt: customer.created_at,
      totalVisits: visitSummary.total_visits,
      totalSpending: parseFloat(visitSummary.total_spending),
      lastVisitDate: visitSummary.last_visit_date,
      memberships: membershipsResult.rows.map((m) => ({
        id: m.id,
        planName: m.plan_name,
        status: m.status,
        startDate: m.start_date,
        endDate: m.end_date,
        usesCount: m.uses_count,
        maxUses: m.max_uses,
      })),
      recentVisits: recentVisitsResult.rows.map((v) => ({
        orderId: v.order_id,
        orderNumber: v.order_number,
        outletName: v.outlet_name,
        date: v.date,
        total: parseFloat(v.total),
        services: servicesByOrder[v.order_id] ?? [],
        paymentMethod: v.payment_method,
      })),
      servicePreferences: servicePrefsResult.rows.map((sp) => ({
        serviceId: sp.service_id,
        serviceName: sp.service_name,
        timesUsed: sp.times_used,
        totalSpent: parseFloat(sp.total_spent),
      })),
      voucherUsage: {
        totalRedeemed: voucher.total_redeemed,
        totalSaved: parseFloat(voucher.total_saved),
      },
      vouchers: ticketsResult.rows.map((v) => ({
        id: v.id,
        code: v.code,
        type: v.benefit_type,
        value: parseFloat(v.benefit_value),
        expiresAt: v.expiry_date,
        // An expired-but-unredeemed ticket usually still reads 'active' in the
        // table (the sweep is periodic); the date is authoritative for display.
        status: v.status === 'redeemed'
          ? 'used'
          : (v.expiry_date && v.expiry_date < today ? 'expired' : 'active'),
        source: v.source === 'bonus' ? 'campaign' : 'purchase',
      })),
    };
  }

  /**
   * Get customer analytics: visit frequency, spending patterns, service preferences, segmentation.
   * Requirements: 34.1, 34.2
   */
  async getAnalytics(tenantId: string, customerId: string): Promise<CustomerAnalytics> {
    // Verify customer exists AND belongs to the caller's tenant (no cross-tenant read).
    const customerCheck = await this.pool.query(
      `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
    );
    if (customerCheck.rows.length === 0) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    // Visit frequency metrics
    const frequencyResult = await this.pool.query<{
      total_visits: number;
      visits_30d: number;
      visits_90d: number;
      avg_days_between: string | null;
    }>(
      `WITH order_dates AS (
        SELECT created_at::date AS visit_date
        FROM orders
        WHERE customer_id = $1 AND status != 'cancelled'
        ORDER BY created_at
      ),
      intervals AS (
        SELECT
          visit_date - LAG(visit_date) OVER (ORDER BY visit_date) AS gap_days
        FROM (SELECT DISTINCT visit_date FROM order_dates) d
      )
      SELECT
        (SELECT COUNT(*)::int FROM order_dates) AS total_visits,
        (SELECT COUNT(*)::int FROM order_dates WHERE visit_date >= CURRENT_DATE - INTERVAL '30 days') AS visits_30d,
        (SELECT COUNT(*)::int FROM order_dates WHERE visit_date >= CURRENT_DATE - INTERVAL '90 days') AS visits_90d,
        (SELECT AVG(gap_days)::text FROM intervals WHERE gap_days IS NOT NULL) AS avg_days_between`,
      [customerId],
    );

    const freq = frequencyResult.rows[0]!;

    // Spending patterns
    const spendingResult = await this.pool.query<{
      total_spending: string;
      avg_order_value: string;
      spending_30d: string;
      spending_90d: string;
      highest_order: string;
    }>(
      `SELECT
        COALESCE(SUM(total), 0)::text AS total_spending,
        COALESCE(AVG(total), 0)::text AS avg_order_value,
        COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN total ELSE 0 END), 0)::text AS spending_30d,
        COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '90 days' THEN total ELSE 0 END), 0)::text AS spending_90d,
        COALESCE(MAX(total), 0)::text AS highest_order
      FROM orders
      WHERE customer_id = $1 AND status != 'cancelled'`,
      [customerId],
    );

    const spend = spendingResult.rows[0]!;

    // Service preferences (top 10)
    const servicePrefsResult = await this.pool.query<{
      service_id: string;
      service_name: string;
      times_used: number;
      total_spent: string;
    }>(
      `SELECT
        s.id AS service_id,
        s.name AS service_name,
        SUM(oi.quantity)::int AS times_used,
        SUM(oi.subtotal)::text AS total_spent
      FROM order_items oi
      JOIN services s ON oi.service_id = s.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = $1 AND o.status != 'cancelled'
      GROUP BY s.id, s.name
      ORDER BY times_used DESC
      LIMIT 10`,
      [customerId],
    );

    // Membership status for segmentation
    const membershipResult = await this.pool.query<{ status: string }>(
      `SELECT status FROM memberships WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );

    // Last visit date for recency
    const lastVisitResult = await this.pool.query<{ last_visit: string | null }>(
      `SELECT MAX(created_at)::text AS last_visit FROM orders WHERE customer_id = $1 AND status != 'cancelled'`,
      [customerId],
    );

    const segmentation = this.computeSegmentation(
      freq.total_visits,
      freq.visits_30d,
      parseFloat(spend.total_spending),
      membershipResult.rows[0]?.status ?? null,
      lastVisitResult.rows[0]?.last_visit ?? null,
    );

    return {
      customerId,
      visitFrequency: {
        totalVisits: freq.total_visits,
        visitsLast30Days: freq.visits_30d,
        visitsLast90Days: freq.visits_90d,
        averageDaysBetweenVisits: freq.avg_days_between
          ? parseFloat(freq.avg_days_between)
          : null,
      },
      spendingPatterns: {
        totalSpending: parseFloat(spend.total_spending),
        averageOrderValue: parseFloat(spend.avg_order_value),
        spendingLast30Days: parseFloat(spend.spending_30d),
        spendingLast90Days: parseFloat(spend.spending_90d),
        highestOrder: parseFloat(spend.highest_order),
      },
      servicePreferences: servicePrefsResult.rows.map((sp) => ({
        serviceId: sp.service_id,
        serviceName: sp.service_name,
        timesUsed: sp.times_used,
        totalSpent: parseFloat(sp.total_spent),
      })),
      segmentation,
    };
  }

  /**
   * Search customers by name or phone.
   * Scoped to tenant via RLS.
   */
  async searchCustomers(
    tenantId: string,
    search: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ customers: CustomerSearchResult[]; total: number }> {
    const offset = (Math.max(page, 1) - 1) * Math.min(pageSize, 100);
    const effectivePageSize = Math.min(pageSize, 100);
    const searchPattern = `%${search.trim()}%`;

    // tenant_id predicate keeps the search within the caller's own customers.
    const countResult = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
      FROM customers
      WHERE tenant_id = $2 AND (name ILIKE $1 OR phone ILIKE $1)`,
      [searchPattern, tenantId],
    );

    const total = countResult.rows[0]?.total ?? 0;

    if (total === 0) {
      return { customers: [], total: 0 };
    }

    const customersResult = await this.pool.query<{
      id: string;
      name: string;
      phone: string;
      membership_status: string | null;
      total_visits: number;
      last_visit_date: string | null;
    }>(
      `SELECT
        c.id,
        c.name,
        c.phone,
        -- Most-actionable membership wins the badge, not merely the newest row.
        -- Picking by created_at alone let a finished membership mask a still-open
        -- one, so the list said "Past member" while the customer detail (which
        -- lists every membership) showed 'pending' (AIRIN-124). Ranking mirrors
        -- MemberLookupService, which already returns memberships most-actionable
        -- first: live > awaiting payment > renewable > blocked > finished.
        (SELECT m.status FROM memberships m
          WHERE m.customer_id = c.id
          ORDER BY CASE m.status
                     WHEN 'active'    THEN 1
                     WHEN 'pending'   THEN 2
                     WHEN 'grace'     THEN 3
                     WHEN 'suspended' THEN 4
                     WHEN 'expired'   THEN 5
                     WHEN 'revoked'   THEN 6
                     WHEN 'cancelled' THEN 7
                     ELSE 8
                   END,
                   m.created_at DESC
          LIMIT 1) AS membership_status,
        (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS total_visits,
        (SELECT MAX(o.created_at)::text FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS last_visit_date
      FROM customers c
      WHERE c.tenant_id = $4 AND (c.name ILIKE $1 OR c.phone ILIKE $1)
      ORDER BY c.name ASC
      LIMIT $2 OFFSET $3`,
      [searchPattern, effectivePageSize, offset, tenantId],
    );

    return {
      customers: customersResult.rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        membershipStatus: r.membership_status,
        totalVisits: r.total_visits,
        lastVisitDate: r.last_visit_date,
      })),
      total,
    };
  }

  /**
   * Compute customer segmentation based on configurable criteria.
   * Requirements: 34.2
   */
  private computeSegmentation(
    _totalVisits: number,
    visitsLast30Days: number,
    totalSpending: number,
    membershipStatus: string | null,
    lastVisitDateStr: string | null,
  ): CustomerSegmentation {
    // Frequency tier: based on visits in last 30 days
    let frequencyTier: CustomerSegmentation['frequencyTier'];
    if (visitsLast30Days >= 8) {
      frequencyTier = 'high';
    } else if (visitsLast30Days >= 4) {
      frequencyTier = 'medium';
    } else if (visitsLast30Days >= 1) {
      frequencyTier = 'low';
    } else {
      frequencyTier = 'inactive';
    }

    // Spend tier: based on total spending
    let spendTier: CustomerSegmentation['spendTier'];
    if (totalSpending >= 5000000) {
      spendTier = 'vip';
    } else if (totalSpending >= 2000000) {
      spendTier = 'high';
    } else if (totalSpending >= 500000) {
      spendTier = 'medium';
    } else {
      spendTier = 'low';
    }

    // Membership status
    let membershipSegment: CustomerSegmentation['membershipStatus'];
    if (membershipStatus === MembershipStatus.Active) {
      membershipSegment = 'active_member';
    } else if (
      membershipStatus === MembershipStatus.Expired ||
      membershipStatus === MembershipStatus.Cancelled
    ) {
      membershipSegment = 'expired_member';
    } else {
      membershipSegment = 'non_member';
    }

    // Recency: based on last visit date
    let recency: CustomerSegmentation['recency'];
    if (!lastVisitDateStr) {
      recency = 'dormant';
    } else {
      const lastVisit = new Date(lastVisitDateStr);
      const daysSinceLastVisit = Math.floor(
        (Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceLastVisit <= 14) {
        recency = 'recent';
      } else if (daysSinceLastVisit <= 60) {
        recency = 'lapsing';
      } else {
        recency = 'dormant';
      }
    }

    return { frequencyTier, spendTier, membershipStatus: membershipSegment, recency };
  }

  /**
   * List customers for the CRM table (tenant-scoped), with optional search.
   */
  async listCustomers(
    tenantId: string,
    page = 1,
    pageSize = 50,
    search?: string,
    outletIds?: string[] | null,
    segment?: 'members' | 'non',
  ): Promise<{ customers: { id: string; name: string; phone: string; createdAt: string; totalVisits: number; membershipStatus: string | null }[]; total: number }> {
    const effectivePageSize = Math.min(Math.max(pageSize, 1), 200);
    const offset = (Math.max(page, 1) - 1) * effectivePageSize;
    // Columns are qualified with the `c` alias so the same WHERE works for both
    // the count and the rows query (customers are tenant-wide; branch filtering
    // means "has at least one non-cancelled order at that branch").
    const where = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (search && search.trim()) {
      where.push(`(c.name ILIKE $${params.length + 1} OR c.phone ILIKE $${params.length + 1})`);
      params.push(`%${search.trim()}%`);
    }
    if (outletIds != null) {
      where.push(
        `EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.outlet_id = ANY($${params.length + 1}::uuid[]) AND o.status <> 'cancelled')`,
      );
      params.push(outletIds);
    }
    // Segment filter: a "member" is any customer with a membership record (any status);
    // "non" is a customer with none. Applied server-side so it spans all pages.
    if (segment === 'members') {
      where.push(`EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id)`);
    } else if (segment === 'non') {
      where.push(`NOT EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id)`);
    }
    const whereSql = where.join(' AND ');
    const countRes = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM customers c WHERE ${whereSql}`,
      params,
    );
    const total = countRes.rows[0]?.total ?? 0;
    const rowsRes = await this.pool.query<{ id: string; name: string; phone: string; created_at: string; total_visits: number; membership_status: string | null }>(
      `SELECT c.id, c.name, c.phone, c.created_at::text,
              (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS total_visits,
              -- Derived member indicator: a date-expired-but-still-'active' row does NOT count as active
              -- (mirrors the benefit-read lifecycle rule). NULL = never a member.
              --
              -- 'pending' MUST be checked before the catch-all: a membership that
              -- has been sold but not yet activated is still collectable, and
              -- lumping it into 'inactive' rendered it as "Past member" — telling
              -- staff the sale was over while payment was still outstanding
              -- (AIRIN-124). Ranked most-actionable-first, matching
              -- MemberLookupService. Anything genuinely finished (expired /
              -- revoked / cancelled) still falls through to 'inactive'.
              (CASE
                 WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id AND m.status = 'active' AND m.end_date >= CURRENT_DATE) THEN 'active'
                 WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id AND m.status = 'pending') THEN 'pending'
                 WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id AND m.status = 'suspended') THEN 'suspended'
                 WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id AND m.status = 'grace') THEN 'grace'
                 WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = c.id) THEN 'inactive'
                 ELSE NULL
               END) AS membership_status
       FROM customers c WHERE ${whereSql}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, effectivePageSize, offset],
    );
    return {
      customers: rowsRes.rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, createdAt: r.created_at, totalVisits: r.total_visits, membershipStatus: r.membership_status })),
      total,
    };
  }

  async updateCustomer(tenantId: string, id: string, patch: { name?: string; phone?: string }): Promise<{ id: string; name: string; phone: string }> {
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.name !== undefined) { set.push(`name = $${i++}`); v.push(patch.name); }
    if (patch.phone !== undefined) { set.push(`phone = $${i++}`); v.push(patch.phone); set.push(`phone_normalized = $${i++}`); v.push(patch.phone.replace(/[^0-9]/g, '')); }
    if (set.length === 0) throw new NotFoundException('No fields to update');
    set.push('updated_at = NOW()'); v.push(id, tenantId);
    const res = await this.pool.query<{ id: string; name: string; phone: string }>(
      `UPDATE customers SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING id, name, phone`,
      v,
    );
    if (res.rows.length === 0) throw new NotFoundException('Customer not found');
    return res.rows[0]!;
  }

  async deleteCustomer(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query('DELETE FROM customers WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Customer not found');
  }
}
