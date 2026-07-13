import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy, BadRequestException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export type CommissionMode = 'pct_of_sale' | 'per_service_pct' | 'per_service_fixed' | 'fixed_per_job';
export type CommissionScope = 'global' | 'service' | 'category' | 'product' | 'staff';

export interface CommissionRuleConfig {
  scope: CommissionScope;
  refId?: string | null; // service_id / category_id / product(service)_id / employee_id (staff)
  mode: CommissionMode;
  value: number; // percentage (0-100) for pct modes, IDR for fixed modes
}

export interface MonthlyTarget {
  employeeId: string;
  target: number; // total non-voided sales in the period
  bonus: number; // flat bonus when the target is met
}

export interface CommissionConfig {
  enabled: boolean;
  rules: CommissionRuleConfig[];
  tipEnabled: boolean;
  monthlyTargets: MonthlyTarget[];
}

const DEFAULT_CONFIG: CommissionConfig = {
  enabled: false,
  rules: [],
  tipEnabled: false,
  monthlyTargets: [],
};

interface OrderItemRow {
  id: string;
  service_id: string;
  category_id: string | null;
  category: string | null;
  quantity: string;
  subtotal: string;
}

/**
 * CommissionService — per-job staff commission that auto-accrues into payroll.
 *
 * On OrderPaid (when enabled) it resolves the sale's salesperson_employee_id,
 * computes commission per line from owner-configured rules (per product/service,
 * per category, or global; percentage-of-sale or fixed), and records ONE
 * commission_accrual per order stamped with the payroll period. On OrderVoided /
 * RefundIssued it reverses the matching accrual. At payroll generation, that
 * period's `accrued` rows for an employee are rolled up into a single pending
 * payroll_adjustments (type='bonus') row — so the existing payroll pipeline pays
 * it out unchanged — and are reversible when a draft run is regenerated.
 *
 * Config (enable toggle, rules, monthly targets) lives in tenants.settings.commission.
 */
@Injectable()
export class CommissionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionService.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.eventBus) return;
    this.unsubscribes.push(
      this.eventBus.on(DomainEventType.OrderPaid, (e) =>
        this.safe(() => this.accrueForOrder(e.tenantId!, (e.payload as { orderId: string }).orderId))),
      this.eventBus.on(DomainEventType.OrderVoided, (e) =>
        this.safe(() => this.reverseForOrder(e.tenantId!, (e.payload as { orderId: string }).orderId))),
      this.eventBus.on(DomainEventType.RefundIssued, (e) =>
        this.safe(() => this.reverseForOrder(e.tenantId!, (e.payload as { orderId: string }).orderId))),
    );
    this.logger.log('Commission accrual subscribed (order.paid, order.voided, refund.issued)');
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Commission accrual failed: ${e instanceof Error ? e.message : e}`); }
  }

  // ─── Config ──────────────────────────────────────────────────────────────

  async getConfig(tenantId: string): Promise<CommissionConfig> {
    const r = await this.pool.query<{ cfg: CommissionConfig | null }>(
      `SELECT settings->'commission' AS cfg FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const cfg = r.rows[0]?.cfg;
    return cfg ? { ...DEFAULT_CONFIG, ...cfg } : { ...DEFAULT_CONFIG };
  }

  async setConfig(tenantId: string, patch: Partial<CommissionConfig>): Promise<CommissionConfig> {
    const current = await this.getConfig(tenantId);
    const next: CommissionConfig = {
      enabled: patch.enabled ?? current.enabled,
      rules: Array.isArray(patch.rules) ? patch.rules : current.rules,
      tipEnabled: patch.tipEnabled ?? current.tipEnabled,
      monthlyTargets: Array.isArray(patch.monthlyTargets) ? patch.monthlyTargets : current.monthlyTargets,
    };
    for (const rule of next.rules) {
      if (!['global', 'service', 'category', 'product', 'staff'].includes(rule.scope)) throw new BadRequestException('invalid rule scope');
      if (rule.scope === 'staff' && !rule.refId) throw new BadRequestException('staff rule requires an employee');
      if (!['pct_of_sale', 'per_service_pct', 'per_service_fixed', 'fixed_per_job'].includes(rule.mode)) throw new BadRequestException('invalid rule mode');
      if (!(Number(rule.value) >= 0)) throw new BadRequestException('rule value must be >= 0');
    }
    await this.pool.query(
      `UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),'{commission}',$2::jsonb,true), updated_at = NOW() WHERE id = $1`,
      [tenantId, JSON.stringify(next)],
    );
    return next;
  }

  // ─── Accrual ───────────────────────────────────────────────────────────────

  private periodOf(dateIso: string): string {
    const d = new Date(dateIso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private resolveRule(rules: CommissionRuleConfig[], serviceId: string, categoryId: string | null, employeeId: string | null): CommissionRuleConfig | null {
    // Precedence: per-staff (this salesperson) → product/service-specific → category → global.
    // A staff rule overrides the generic rules so an individual's rate always wins.
    return (
      (employeeId ? rules.find((r) => r.scope === 'staff' && r.refId === employeeId) : undefined) ??
      rules.find((r) => (r.scope === 'product' || r.scope === 'service') && r.refId === serviceId) ??
      (categoryId ? rules.find((r) => r.scope === 'category' && r.refId === categoryId) : undefined) ??
      rules.find((r) => r.scope === 'global') ??
      null
    );
  }

  private lineCommission(rule: CommissionRuleConfig, subtotal: number, quantity: number): number {
    switch (rule.mode) {
      case 'pct_of_sale':
      case 'per_service_pct':
        return (subtotal * rule.value) / 100;
      case 'per_service_fixed':
        return rule.value * quantity;
      case 'fixed_per_job':
        return rule.value; // once per line-match; capped to order-grain below
      default:
        return 0;
    }
  }

  async accrueForOrder(tenantId: string, orderId: string): Promise<boolean> {
    const cfg = await this.getConfig(tenantId);
    if (!cfg.enabled || cfg.rules.length === 0) return false;

    const ord = await this.pool.query<{ salesperson_employee_id: string | null; outlet_id: string | null; status: string; created_at: string; paid_at: string | null }>(
      `SELECT salesperson_employee_id, outlet_id, status, created_at, paid_at FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const o = ord.rows[0];
    if (!o || !o.salesperson_employee_id) return false;
    if (!['paid', 'confirmed', 'completed'].includes(o.status)) return false;

    // Idempotent: skip if a live accrual already exists for this order+employee.
    const exists = await this.pool.query(
      `SELECT 1 FROM commission_accruals WHERE order_id = $1 AND employee_id = $2 AND type = 'commission' AND status <> 'reversed' LIMIT 1`,
      [orderId, o.salesperson_employee_id],
    );
    if ((exists.rowCount ?? 0) > 0) return false;

    const items = await this.pool.query<OrderItemRow>(
      `SELECT oi.id, oi.service_id, s.category_id, s.category, oi.quantity, oi.subtotal
       FROM order_items oi LEFT JOIN services s ON s.id = oi.service_id WHERE oi.order_id = $1`,
      [orderId],
    );

    let total = 0;
    let fixedPerJobApplied = false;
    for (const it of items.rows) {
      const rule = this.resolveRule(cfg.rules, it.service_id, it.category_id, o.salesperson_employee_id);
      if (!rule) continue;
      if (rule.mode === 'fixed_per_job') {
        if (fixedPerJobApplied) continue; // once per order
        fixedPerJobApplied = true;
      }
      total += this.lineCommission(rule, parseFloat(it.subtotal) || 0, parseFloat(it.quantity) || 0);
    }
    total = Math.round(total * 100) / 100;
    if (!(total > 0)) return false;

    const period = this.periodOf(o.paid_at ?? o.created_at);
    await this.pool.query(
      `INSERT INTO commission_accruals (tenant_id, outlet_id, order_id, employee_id, period, type, basis, amount, status)
       VALUES ($1,$2,$3,$4,$5,'commission',$6,$7,'accrued')`,
      [tenantId, o.outlet_id, orderId, o.salesperson_employee_id, period, JSON.stringify({ rules: cfg.rules }), total],
    );
    void this.eventBus?.emit({ type: DomainEventType.CommissionAccrued, tenantId, outletId: o.outlet_id, payload: { orderId, employeeId: o.salesperson_employee_id, amount: total, period } });
    return true;
  }

  /** Reverse accruals for a voided/refunded order (only while still un-applied). */
  async reverseForOrder(tenantId: string, orderId: string): Promise<void> {
    await this.pool.query(
      `UPDATE commission_accruals SET status = 'reversed', updated_at = NOW()
       WHERE tenant_id = $1 AND order_id = $2 AND status = 'accrued'`,
      [tenantId, orderId],
    );
  }

  // ─── Payroll bridge (called inside the payroll transaction) ─────────────────

  /**
   * Roll this period's accrued commission (+ any met monthly target bonus) for one
   * employee into a single pending bonus adjustment. Returns the adjustment id, or
   * null if nothing to accrue. The caller's existing pending-adjustment sum picks it up.
   */
  async rollupIntoPayroll(client: PoolClient, tenantId: string, employeeId: string, period: string, runId: string): Promise<string | null> {
    const accr = await client.query<{ ids: string[]; total: string }>(
      `SELECT COALESCE(array_agg(id),'{}') AS ids, COALESCE(SUM(amount),0) AS total
       FROM commission_accruals
       WHERE tenant_id = $1 AND employee_id = $2 AND period = $3 AND status = 'accrued'`,
      [tenantId, employeeId, period],
    );
    let total = parseFloat(accr.rows[0]!.total) || 0;
    const ids = accr.rows[0]!.ids || [];

    // Monthly target bonus: flat bonus when period non-voided sales ≥ target.
    const cfg = await this.getConfig(tenantId);
    const target = cfg.monthlyTargets.find((t) => t.employeeId === employeeId);
    let targetBonus = 0;
    if (target && target.bonus > 0 && target.target > 0) {
      const sales = await client.query<{ s: string }>(
        `SELECT COALESCE(SUM(total),0) AS s FROM orders
         WHERE tenant_id = $1 AND salesperson_employee_id = $2
           AND status IN ('paid','confirmed','completed') AND to_char(COALESCE(paid_at,created_at),'YYYY-MM') = $3`,
        [tenantId, employeeId, period],
      );
      if ((parseFloat(sales.rows[0]!.s) || 0) >= target.target) targetBonus = target.bonus;
    }

    total = Math.round((total + targetBonus) * 100) / 100;
    if (!(total > 0)) return null;

    const adj = await client.query<{ id: string }>(
      `INSERT INTO payroll_adjustments (tenant_id, employee_id, type, amount, reason, effective_period, status)
       VALUES ($1,$2,'bonus',$3,$4,$5,'pending') RETURNING id`,
      [tenantId, employeeId, total, `Commission ${period}`, period],
    );
    const adjustmentId = adj.rows[0]!.id;

    if (ids.length > 0) {
      await client.query(
        `UPDATE commission_accruals SET status = 'applied', applied_adjustment_id = $1, applied_run_id = $2, updated_at = NOW()
         WHERE id = ANY($3::uuid[])`,
        [adjustmentId, runId, ids],
      );
    }
    if (targetBonus > 0) {
      await client.query(
        `INSERT INTO commission_accruals (tenant_id, employee_id, period, type, basis, amount, status, applied_adjustment_id, applied_run_id)
         VALUES ($1,$2,$3,'monthly_bonus',$4,$5,'applied',$6,$7)`,
        [tenantId, employeeId, period, JSON.stringify({ target }), targetBonus, adjustmentId, runId],
      );
    }
    return adjustmentId;
  }

  /** Undo a run's commission rollup: restore accruals + delete the origin adjustments. */
  async reversePayrollRollup(client: PoolClient, tenantId: string, runId: string): Promise<void> {
    const adjRows = await client.query<{ applied_adjustment_id: string | null }>(
      `SELECT DISTINCT applied_adjustment_id FROM commission_accruals
       WHERE tenant_id = $1 AND applied_run_id = $2 AND applied_adjustment_id IS NOT NULL`,
      [tenantId, runId],
    );
    const adjIds = adjRows.rows.map((r) => r.applied_adjustment_id).filter(Boolean) as string[];
    // Drop monthly_bonus synthetic accruals; restore commission accruals to 'accrued'.
    await client.query(`DELETE FROM commission_accruals WHERE tenant_id = $1 AND applied_run_id = $2 AND type = 'monthly_bonus'`, [tenantId, runId]);
    await client.query(
      `UPDATE commission_accruals SET status = 'accrued', applied_adjustment_id = NULL, applied_run_id = NULL, updated_at = NOW()
       WHERE tenant_id = $1 AND applied_run_id = $2`,
      [tenantId, runId],
    );
    if (adjIds.length > 0) {
      await client.query(`DELETE FROM payroll_adjustments WHERE id = ANY($1::uuid[])`, [adjIds]);
    }
  }

  // ─── Reports ────────────────────────────────────────────────────────────────

  async report(tenantId: string, opts: { period?: string; outletId?: string } = {}) {
    const conds = ['ca.tenant_id = $1', "ca.status <> 'reversed'"];
    const params: unknown[] = [tenantId];
    if (opts.period) { params.push(opts.period); conds.push(`ca.period = $${params.length}`); }
    if (opts.outletId) { params.push(opts.outletId); conds.push(`ca.outlet_id = $${params.length}`); }
    const rows = await this.pool.query(
      `SELECT e.id AS employee_id, e.name AS employee_name, ca.period,
              COUNT(*) FILTER (WHERE ca.type = 'commission') AS orders,
              COALESCE(SUM(ca.amount),0) AS total,
              COUNT(*) FILTER (WHERE ca.status = 'applied') AS applied_count
       FROM commission_accruals ca JOIN employees e ON e.id = ca.employee_id
       WHERE ${conds.join(' AND ')}
       GROUP BY e.id, e.name, ca.period
       ORDER BY ca.period DESC, total DESC`,
      params,
    );
    return rows.rows.map((r) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      period: r.period,
      orders: parseInt(r.orders, 10) || 0,
      total: parseFloat(r.total) || 0,
      appliedCount: parseInt(r.applied_count, 10) || 0,
    }));
  }

  async listAccruals(tenantId: string, opts: { period?: string; employeeId?: string } = {}) {
    const conds = ['ca.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (opts.period) { params.push(opts.period); conds.push(`ca.period = $${params.length}`); }
    if (opts.employeeId) { params.push(opts.employeeId); conds.push(`ca.employee_id = $${params.length}`); }
    const rows = await this.pool.query(
      `SELECT ca.id, ca.order_id, o.order_number, e.name AS employee_name, ca.period, ca.type, ca.amount, ca.status, ca.created_at
       FROM commission_accruals ca
       JOIN employees e ON e.id = ca.employee_id
       LEFT JOIN orders o ON o.id = ca.order_id
       WHERE ${conds.join(' AND ')}
       ORDER BY ca.created_at DESC LIMIT 500`,
      params,
    );
    return rows.rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      employeeName: r.employee_name,
      period: r.period,
      type: r.type,
      amount: parseFloat(r.amount) || 0,
      status: r.status,
      createdAt: r.created_at,
    }));
  }
}
