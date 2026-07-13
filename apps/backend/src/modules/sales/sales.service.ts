import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface CreateLeadDto {
  name: string;
  phone?: string;
  source?: string;
  notes?: string;
}

export interface SetTargetDto {
  period: string; // YYYY-MM
  targetAmount: number;
  outletId?: string;
}

const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'];

/**
 * SalesService — lead pipeline + monthly sales targets with actual-vs-target
 * tracking (actuals from paid orders). Self-reliant; emits events.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async listLeads(tenantId: string, status?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    const res = await this.pool.query(
      `SELECT id, name, phone, source, status, notes, created_at FROM sales_leads
       WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, name: r.name, phone: r.phone, source: r.source, status: r.status, notes: r.notes, createdAt: r.created_at,
    }));
  }

  async createLead(tenantId: string, dto: CreateLeadDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query(
      `INSERT INTO sales_leads (tenant_id, name, phone, source, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId, dto.name.trim(), dto.phone ?? null, dto.source ?? null, dto.notes ?? null, actor ?? null],
    );
    const l = res.rows[0]!;
    void this.eventBus?.emit({
      type: DomainEventType.SalesLeadCreated,
      tenantId, actor: actor ?? 'system',
      payload: { leadId: l.id, name: l.name, source: l.source },
    });
    return { id: l.id, name: l.name, status: l.status };
  }

  async updateLeadStatus(tenantId: string, id: string, status: string, actor?: string): Promise<Record<string, unknown>> {
    if (!LEAD_STATUSES.includes(status)) throw new BadRequestException(`status must be one of: ${LEAD_STATUSES.join(', ')}`);
    const res = await this.pool.query(
      `UPDATE sales_leads SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING id, name, status`,
      [status, id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Lead not found');
    void this.eventBus?.emit({
      type: DomainEventType.SalesLeadStatusChanged,
      tenantId, actor: actor ?? 'system',
      payload: { leadId: id, status },
    });
    return res.rows[0]!;
  }

  /**
   * Upsert a target for a period. `outletId` set → a branch target; omitted →
   * the tenant-wide overall target. The two live in disjoint partial unique
   * indexes (see migration 062), so each has its own ON CONFLICT target.
   */
  async setTarget(tenantId: string, dto: SetTargetDto, actor?: string): Promise<Record<string, unknown>> {
    if (!/^\d{4}-\d{2}$/.test(dto.period)) throw new BadRequestException('period must be YYYY-MM');
    if (!dto.targetAmount || dto.targetAmount <= 0) throw new BadRequestException('targetAmount must be positive');
    const isBranch = !!dto.outletId;
    const conflict = isBranch
      ? '(tenant_id, outlet_id, period) WHERE outlet_id IS NOT NULL'
      : '(tenant_id, period) WHERE outlet_id IS NULL';
    const res = await this.pool.query(
      `INSERT INTO sales_targets (tenant_id, outlet_id, period, target_amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ${conflict} DO UPDATE SET target_amount = EXCLUDED.target_amount
       RETURNING id, outlet_id, period, target_amount`,
      [tenantId, dto.outletId ?? null, dto.period, dto.targetAmount],
    );
    const t = res.rows[0]!;
    void this.eventBus?.emit({
      type: DomainEventType.SalesTargetSet,
      tenantId, actor: actor ?? 'system',
      payload: { period: t.period, outletId: t.outlet_id, targetAmount: parseFloat(t.target_amount) },
    });
    return { id: t.id, outletId: t.outlet_id, period: t.period, targetAmount: parseFloat(t.target_amount) };
  }

  /**
   * All targets for a period: the overall (tenant-wide) target plus every branch
   * target, with branch names. Feeds the target-management UI.
   */
  async listTargets(tenantId: string, period?: string): Promise<Record<string, unknown>> {
    const p = period && /^\d{4}-\d{2}$/.test(period) ? period : new Date().toISOString().slice(0, 7);
    const res = await this.pool.query<{ id: string; outlet_id: string | null; outlet_name: string | null; target_amount: string }>(
      `SELECT st.id, st.outlet_id, o.name AS outlet_name, st.target_amount
       FROM sales_targets st
       LEFT JOIN outlets o ON o.id = st.outlet_id
       WHERE st.tenant_id = $1 AND st.period = $2
       ORDER BY (st.outlet_id IS NOT NULL), o.name`,
      [tenantId, p],
    );
    const overall = res.rows.find((r) => r.outlet_id == null);
    const branches = res.rows
      .filter((r) => r.outlet_id != null)
      .map((r) => ({ outletId: r.outlet_id, outletName: r.outlet_name, targetAmount: parseFloat(r.target_amount) }));
    return {
      period: p,
      overall: overall ? parseFloat(overall.target_amount) : null,
      branches,
    };
  }

  /**
   * Per-branch and per-employee sales performance for a period, scoped to the
   * caller's branch set. `byBranch` pairs each branch's paid revenue with its
   * target + attainment; `byEmployee` ranks operators (cashiers) by revenue so
   * the UI can surface best/worst performers globally or within one branch.
   */
  async performance(tenantId: string, outletIds?: string[] | null, period?: string): Promise<Record<string, unknown>> {
    const p = period && /^\d{4}-\d{2}$/.test(period) ? period : new Date().toISOString().slice(0, 7);
    const args: unknown[] = [tenantId, p, outletIds ?? null];
    // Columns are qualified to the orders alias `ord` because this fragment is
    // spliced into multi-table JOINs below where `created_at`/`outlet_id` are
    // otherwise ambiguous (outlets and users also define them).
    const paid = `ord.status IN ('paid','confirmed','completed') AND to_char(ord.created_at, 'YYYY-MM') = $2
                  AND ($3::uuid[] IS NULL OR ord.outlet_id = ANY($3::uuid[]))`;

    const branch = await this.pool.query<{ outlet_id: string; name: string; revenue: string; orders: string; target: string | null }>(
      `SELECT o.id AS outlet_id, o.name,
              COALESCE(SUM(ord.total), 0) AS revenue,
              COUNT(ord.id) AS orders,
              st.target_amount AS target
       FROM outlets o
       LEFT JOIN orders ord ON ord.outlet_id = o.id AND ${paid}
       LEFT JOIN sales_targets st ON st.tenant_id = o.tenant_id AND st.outlet_id = o.id AND st.period = $2
       WHERE o.tenant_id = $1 AND ($3::uuid[] IS NULL OR o.id = ANY($3::uuid[]))
       GROUP BY o.id, o.name, st.target_amount
       ORDER BY revenue DESC`,
      args,
    );

    const employee = await this.pool.query<{ operator_id: string; name: string; outlet_id: string; outlet_name: string; revenue: string; orders: string }>(
      `SELECT ord.operator_id, u.name, ord.outlet_id, o.name AS outlet_name,
              COALESCE(SUM(ord.total), 0) AS revenue, COUNT(ord.id) AS orders
       FROM orders ord
       JOIN users u ON u.id = ord.operator_id
       JOIN outlets o ON o.id = ord.outlet_id
       WHERE ord.tenant_id = $1 AND ${paid}
       GROUP BY ord.operator_id, u.name, ord.outlet_id, o.name
       ORDER BY revenue DESC`,
      args,
    );

    return {
      period: p,
      byBranch: branch.rows.map((r) => {
        const revenue = parseFloat(r.revenue);
        const target = r.target != null ? parseFloat(r.target) : null;
        return {
          outletId: r.outlet_id,
          name: r.name,
          revenue,
          orders: parseInt(r.orders, 10),
          target,
          attainmentPct: target && target > 0 ? Math.round((revenue / target) * 100) : null,
        };
      }),
      byEmployee: employee.rows.map((r) => {
        const revenue = parseFloat(r.revenue);
        const orders = parseInt(r.orders, 10);
        return {
          operatorId: r.operator_id,
          name: r.name,
          outletId: r.outlet_id,
          outletName: r.outlet_name,
          revenue,
          orders,
          avgOrder: orders > 0 ? Math.round(revenue / orders) : 0,
        };
      }),
    };
  }

  /**
   * Sales summary: this month's actual (paid orders) vs target + lead funnel.
   * Optional per-branch (outletId) scoping for actual + target; the lead funnel
   * stays tenant-wide because leads are not branch-scoped.
   */
  async summary(tenantId: string, outletIds?: string[] | null): Promise<Record<string, unknown>> {
    const period = new Date().toISOString().slice(0, 7);
    // $3 = outlet ids (optional); no-op when NULL (all branches).
    const p: unknown[] = [tenantId, period, outletIds ?? null];
    const actual = await this.pool.query<{ total: string; orders: string }>(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS orders FROM orders
       WHERE tenant_id = $1 AND status IN ('paid','confirmed','completed')
         AND to_char(created_at, 'YYYY-MM') = $2
         AND ($3::uuid[] IS NULL OR outlet_id = ANY($3::uuid[]))`,
      p,
    );
    // Target resolution avoids double-counting the overall (NULL-outlet) row
    // against per-branch rows:
    //  - global scope (outletIds NULL): use the explicit overall target if set,
    //    otherwise roll up all branch targets;
    //  - single/subset scope: sum only those branches' targets.
    const target = await this.pool.query<{ target_amount: string }>(
      `SELECT CASE
                WHEN $3::uuid[] IS NULL THEN
                  COALESCE(
                    (SELECT target_amount FROM sales_targets
                       WHERE tenant_id = $1 AND period = $2 AND outlet_id IS NULL),
                    (SELECT SUM(target_amount) FROM sales_targets
                       WHERE tenant_id = $1 AND period = $2 AND outlet_id IS NOT NULL)
                  )
                ELSE
                  (SELECT SUM(target_amount) FROM sales_targets
                     WHERE tenant_id = $1 AND period = $2 AND outlet_id = ANY($3::uuid[]))
              END AS target_amount`,
      p,
    );
    const funnel = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM sales_leads WHERE tenant_id = $1 GROUP BY status`,
      [tenantId],
    );
    const actualAmount = parseFloat(actual.rows[0]!.total);
    const targetAmount = target.rows[0]!.target_amount ? parseFloat(target.rows[0]!.target_amount) : 0;
    // Forecast = run-rate projection of month-end revenue at the current daily pace,
    // so target attainment can be judged mid-month (actual vs forecast vs target).
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projected = dayOfMonth > 0 ? Math.round((actualAmount / dayOfMonth) * daysInMonth) : actualAmount;
    return {
      period,
      actual: actualAmount,
      target: targetAmount,
      attainmentPct: targetAmount > 0 ? Math.round((actualAmount / targetAmount) * 100) : null,
      projected,
      projectedAttainmentPct: targetAmount > 0 ? Math.round((projected / targetAmount) * 100) : null,
      dayOfMonth,
      daysInMonth,
      orders: parseInt(actual.rows[0]!.orders, 10),
      leadFunnel: Object.fromEntries(funnel.rows.map((f) => [f.status, parseInt(f.count, 10)])),
    };
  }
}
