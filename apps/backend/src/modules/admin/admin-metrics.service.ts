import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/** Order statuses that count as realized revenue. */
const PAID = `('paid','confirmed','completed')`;

export type MetricScope = 'global' | 'tenant' | 'branch';

export interface PlatformOverview {
  tenants: { total: number; active: number; suspended: number; cancelled: number; new30d: number };
  outlets: number;
  users: number;
  customers: number;
  ordersToday: number;
  revenueToday: number;
  revenue7d: number;
  revenue30d: number;
  activeMemberships: number;
  estimatedMrr: number;
  aiCalls30d: number;
}

@Injectable()
export class AdminMetricsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private num(v: unknown): number {
    return v == null ? 0 : Number(v);
  }

  async getOverview(): Promise<PlatformOverview> {
    const [tenants, outlets, users, customers, ordersToday, rev, mems, ai, cfg] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status='active')::int AS active,
           COUNT(*) FILTER (WHERE status='suspended')::int AS suspended,
           COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
           COUNT(*) FILTER (WHERE created_at > NOW()-INTERVAL '30 days')::int AS new30d
         FROM tenants`,
      ),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM outlets`),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM users`),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM customers`),
      this.pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(total) FILTER (WHERE status IN ${PAID}),0) AS rev
         FROM orders WHERE created_at::date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date`,
      ),
      this.pool.query(
        `SELECT
           COALESCE(SUM(total) FILTER (WHERE created_at > NOW()-INTERVAL '7 days'),0) AS r7,
           COALESCE(SUM(total) FILTER (WHERE created_at > NOW()-INTERVAL '30 days'),0) AS r30
         FROM orders WHERE status IN ${PAID}`,
      ),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM memberships WHERE status='active'`),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM agent_invocations WHERE created_at > NOW()-INTERVAL '30 days'`).catch(() => ({ rows: [{ n: 0 }] })),
      this.pool.query(`SELECT config FROM platform_config WHERE id='default' LIMIT 1`).catch(() => ({ rows: [] as { config: any }[] })),
    ]);

    // MRR = sum of plan price per active tenant, using platform_config pricing tiers.
    const tiers: { plan: string; price: number }[] = cfg.rows[0]?.config?.pricingTiers ?? [];
    const priceByPlan = new Map(tiers.map((t) => [t.plan, Number(t.price) || 0]));
    const planCounts = await this.pool.query<{ plan: string; n: string }>(
      `SELECT plan, COUNT(*) AS n FROM tenants WHERE status='active' GROUP BY plan`,
    );
    const estimatedMrr = planCounts.rows.reduce((s, r) => s + (priceByPlan.get(r.plan) ?? 0) * Number(r.n), 0);

    const t = tenants.rows[0];
    return {
      tenants: { total: t.total, active: t.active, suspended: t.suspended, cancelled: t.cancelled, new30d: t.new30d },
      outlets: outlets.rows[0].n,
      users: users.rows[0].n,
      customers: customers.rows[0].n,
      ordersToday: ordersToday.rows[0].n,
      revenueToday: this.num(ordersToday.rows[0].rev),
      revenue7d: this.num(rev.rows[0].r7),
      revenue30d: this.num(rev.rows[0].r30),
      activeMemberships: mems.rows[0].n,
      estimatedMrr,
      aiCalls30d: ai.rows[0].n,
    };
  }

  /** Per-tenant rollups for the tenants table. */
  async getTenantsEnriched() {
    const r = await this.pool.query(
      `SELECT t.id, t.name, t.slug, t.plan, t.status, t.created_at,
         (SELECT COUNT(*) FROM outlets o WHERE o.tenant_id=t.id)::int AS outlets,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id)::int AS users,
         (SELECT COUNT(*) FROM orders od WHERE od.tenant_id=t.id AND od.created_at > NOW()-INTERVAL '30 days')::int AS orders30d,
         (SELECT COALESCE(SUM(total),0) FROM orders od WHERE od.tenant_id=t.id AND od.status IN ${PAID} AND od.created_at > NOW()-INTERVAL '30 days') AS revenue30d,
         (SELECT MAX(created_at) FROM orders od WHERE od.tenant_id=t.id) AS last_order
       FROM tenants t ORDER BY t.created_at DESC`,
    );
    return r.rows.map((x: any) => ({
      id: x.id, name: x.name, slug: x.slug, plan: x.plan, status: x.status,
      createdAt: x.created_at, outlets: x.outlets, users: x.users,
      orders30d: x.orders30d, revenue30d: this.num(x.revenue30d),
      lastOrderAt: x.last_order,
    }));
  }

  async getTenantDetail(tenantId: string) {
    const [tenant, outlets, users, stats] = await Promise.all([
      this.pool.query(`SELECT id, name, slug, plan, status, created_at FROM tenants WHERE id=$1`, [tenantId]),
      this.pool.query(`SELECT id, name, code, is_active, phone FROM outlets WHERE tenant_id=$1 ORDER BY created_at`, [tenantId]),
      this.pool.query(`SELECT id, name, email, role FROM users WHERE tenant_id=$1 ORDER BY role, name`, [tenantId]),
      this.pool.query(
        `SELECT
           (SELECT COUNT(*) FROM orders WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '30 days')::int AS orders30d,
           (SELECT COALESCE(SUM(total),0) FROM orders WHERE tenant_id=$1 AND status IN ${PAID} AND created_at > NOW()-INTERVAL '30 days') AS revenue30d,
           (SELECT COUNT(*) FROM memberships WHERE tenant_id=$1 AND status='active')::int AS active_members,
           (SELECT COUNT(*) FROM customers WHERE tenant_id=$1)::int AS customers`,
        [tenantId],
      ),
    ]);
    if (tenant.rows.length === 0) return null;
    const s = stats.rows[0];
    return {
      tenant: tenant.rows[0],
      outlets: outlets.rows,
      users: users.rows,
      stats: { orders30d: s.orders30d, revenue30d: this.num(s.revenue30d), activeMembers: s.active_members, customers: s.customers },
    };
  }

  /** Recent platform-wide activity from the audit log. */
  async getActivity(limit = 50) {
    try {
      const r = await this.pool.query(
        `SELECT a.created_at, a.operation, a.entity_type, a.tenant_id, t.name AS tenant_name
         FROM audit_logs a LEFT JOIN tenants t ON t.id = a.tenant_id
         ORDER BY a.created_at DESC LIMIT $1`,
        [limit],
      );
      return r.rows.map((x: any) => ({
        at: x.created_at, operation: x.operation, entityType: x.entity_type,
        tenantId: x.tenant_id, tenantName: x.tenant_name,
      }));
    } catch {
      return [];
    }
  }

  // ── AI usage (global / per-tenant / per-branch) ─────────────────────────────
  async getAiUsage(opts: { scope: MetricScope; tenantId?: string; outletId?: string; windowDays?: number }) {
    const win = `${opts.windowDays ?? 30} days`;
    const { where, params } = this.scopeWhere(opts, ['created_at > NOW()-$IDX::interval'], [win]);

    const totals = await this.pool.query(
      `SELECT
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE status='success')::int AS ok,
         COUNT(*) FILTER (WHERE status='error')::int AS errors,
         COALESCE(SUM(prompt_tokens),0)::int AS prompt_tokens,
         COALESCE(SUM(completion_tokens),0)::int AS completion_tokens,
         COALESCE(ROUND(AVG(duration_ms)),0)::int AS avg_ms
       FROM agent_invocations WHERE ${where}`,
      params,
    ).catch(() => ({ rows: [{ calls: 0, ok: 0, errors: 0, prompt_tokens: 0, completion_tokens: 0, avg_ms: 0 }] }));

    const byKind = await this.pool.query(
      `SELECT kind, COUNT(*)::int AS n FROM agent_invocations WHERE ${where} GROUP BY kind ORDER BY n DESC`,
      params,
    ).catch(() => ({ rows: [] }));

    const series = await this.pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
       FROM agent_invocations WHERE ${where} GROUP BY 1 ORDER BY 1`,
      params,
    ).catch(() => ({ rows: [] }));

    // For global scope, also break down by tenant.
    let byTenant: { tenantId: string; name: string; calls: number }[] = [];
    if (opts.scope === 'global') {
      const r = await this.pool.query(
        `SELECT a.tenant_id, t.name, COUNT(*)::int AS calls
         FROM agent_invocations a LEFT JOIN tenants t ON t.id=a.tenant_id
         WHERE a.created_at > NOW()-$1::interval
         GROUP BY a.tenant_id, t.name ORDER BY calls DESC LIMIT 20`,
        [win],
      ).catch(() => ({ rows: [] as any[] }));
      byTenant = r.rows.map((x: any) => ({ tenantId: x.tenant_id, name: x.name ?? '—', calls: x.calls }));
    }

    return { totals: totals.rows[0], byKind: byKind.rows, series: series.rows, byTenant };
  }

  // ── Operational monitoring (orders/revenue) at any scope ────────────────────
  async getOpsMonitoring(opts: { scope: MetricScope; tenantId?: string; outletId?: string; windowDays?: number }) {
    const win = `${opts.windowDays ?? 30} days`;
    const { where, params } = this.scopeWhere(opts, ['created_at > NOW()-$IDX::interval'], [win]);

    const totals = await this.pool.query(
      `SELECT
         COUNT(*)::int AS orders,
         COUNT(*) FILTER (WHERE status IN ${PAID})::int AS paid,
         COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
         COALESCE(SUM(total) FILTER (WHERE status IN ${PAID}),0) AS revenue,
         COUNT(DISTINCT customer_id)::int AS customers
       FROM orders WHERE ${where}`,
      params,
    );
    const series = await this.pool.query(
      `SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS day,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total) FILTER (WHERE status IN ${PAID}),0) AS revenue
       FROM orders WHERE ${where} GROUP BY 1 ORDER BY 1`,
      params,
    );
    const t = totals.rows[0];
    return {
      totals: { orders: t.orders, paid: t.paid, cancelled: t.cancelled, revenue: this.num(t.revenue), customers: t.customers },
      series: series.rows.map((x: any) => ({ day: x.day, orders: x.orders, revenue: this.num(x.revenue) })),
    };
  }

  /** Branches for a tenant (to populate the per-branch monitoring selector). */
  async getBranches(tenantId: string) {
    const r = await this.pool.query(`SELECT id, name FROM outlets WHERE tenant_id=$1 ORDER BY name`, [tenantId]);
    return r.rows;
  }

  /** Build a scope-aware WHERE clause + params, numbering placeholders from 1. */
  private scopeWhere(
    opts: { scope: MetricScope; tenantId?: string; outletId?: string },
    baseClauses: string[],
    baseParams: unknown[],
  ): { where: string; params: unknown[] } {
    const params = [...baseParams];
    const clauses = baseClauses.map((c) => c.replace('$IDX', `$${params.length}`));
    if (opts.scope === 'tenant' && opts.tenantId) {
      params.push(opts.tenantId);
      clauses.push(`tenant_id = $${params.length}`);
    } else if (opts.scope === 'branch' && opts.outletId) {
      params.push(opts.outletId);
      clauses.push(`outlet_id = $${params.length}`);
    }
    return { where: clauses.join(' AND '), params };
  }
}
