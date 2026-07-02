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

  async setTarget(tenantId: string, dto: SetTargetDto, actor?: string): Promise<Record<string, unknown>> {
    if (!/^\d{4}-\d{2}$/.test(dto.period)) throw new BadRequestException('period must be YYYY-MM');
    if (!dto.targetAmount || dto.targetAmount <= 0) throw new BadRequestException('targetAmount must be positive');
    const res = await this.pool.query(
      `INSERT INTO sales_targets (tenant_id, outlet_id, period, target_amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, outlet_id, period) DO UPDATE SET target_amount = EXCLUDED.target_amount
       RETURNING id, period, target_amount`,
      [tenantId, dto.outletId ?? null, dto.period, dto.targetAmount],
    );
    const t = res.rows[0]!;
    void this.eventBus?.emit({
      type: DomainEventType.SalesTargetSet,
      tenantId, actor: actor ?? 'system',
      payload: { period: t.period, targetAmount: parseFloat(t.target_amount) },
    });
    return { id: t.id, period: t.period, targetAmount: parseFloat(t.target_amount) };
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
    const target = await this.pool.query<{ target_amount: string }>(
      `SELECT SUM(target_amount) AS target_amount FROM sales_targets
       WHERE tenant_id = $1 AND period = $2 AND ($3::uuid[] IS NULL OR outlet_id = ANY($3::uuid[]))`,
      p,
    );
    const funnel = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM sales_leads WHERE tenant_id = $1 GROUP BY status`,
      [tenantId],
    );
    const actualAmount = parseFloat(actual.rows[0]!.total);
    const targetAmount = target.rows[0]!.target_amount ? parseFloat(target.rows[0]!.target_amount) : 0;
    return {
      period,
      actual: actualAmount,
      target: targetAmount,
      attainmentPct: targetAmount > 0 ? Math.round((actualAmount / targetAmount) * 100) : null,
      orders: parseInt(actual.rows[0]!.orders, 10),
      leadFunnel: Object.fromEntries(funnel.rows.map((f) => [f.status, parseInt(f.count, 10)])),
    };
  }
}
