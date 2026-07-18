import { Injectable, Inject, Optional, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { PlatformPlanService } from './platform-plan.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PlatformTaxService } from './platform-tax.service';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { JobMonitorService } from '../job-monitor';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Days an invoice can be overdue before the tenant is flagged past_due / suspended. */
const DEFAULT_GRACE_DAYS = 7;
const DEFAULT_SUSPEND_DAYS = 14;

/** Coarse interval for the background invoice job (single-instance backend). */
const INVOICE_JOB_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12h — cheap, converges same-day

/**
 * Postgres advisory-lock key for the billing job. Ensures only ONE runner
 * executes at a time even if the backend is ever scaled to multiple instances
 * (today it's single-instance, but the lock makes the job safe regardless).
 */
const BILLING_LOCK_KEY = 4920500;

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface PlatformInvoice {
  id: string;
  tenantId: string;
  tenantName: string | null;
  period: string;
  planCode: string | null;
  amount: number; // tax base (DPP)
  taxRate: number;
  taxAmount: number;
  total: number; // amount + taxAmount — the payable
  fakturNumber: string | null;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListFilters {
  status?: InvoiceStatus;
  tenantId?: string;
  period?: string;
}

interface InvoiceRow {
  id: string; tenant_id: string; tenant_name: string | null; period: string;
  plan_code: string | null; amount: string; currency: string; status: InvoiceStatus;
  tax_rate: string | null; tax_amount: string | null; faktur_number: string | null;
  issued_at: string | null; due_date: string | null; paid_at: string | null;
  notes: string | null; created_at: string; updated_at: string;
}

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'void'];

/**
 * Platform subscription invoicing. Generates one invoice per active tenant per
 * month from the tenant's assigned plan price (snapshotted onto the row), and
 * tracks its lifecycle (draft → sent → paid, or overdue/void). This is the real
 * billing ledger, distinct from the on-the-fly estimated-MRR rollup.
 */
@Injectable()
export class PlatformInvoiceService implements OnModuleInit {
  private readonly logger = new Logger(PlatformInvoiceService.name);
  private running = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly plans: PlatformPlanService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly tax: PlatformTaxService,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly jobMonitor?: JobMonitorService,
  ) {}

  private graceDays(): number {
    const v = parseInt(process.env.PLATFORM_DUNNING_GRACE_DAYS ?? '', 10);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_GRACE_DAYS;
  }

  private suspendDays(): number {
    const v = parseInt(process.env.PLATFORM_DUNNING_SUSPEND_DAYS ?? '', 10);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SUSPEND_DAYS;
  }

  /**
   * Background billing job: generate the current month's draft invoices and flip
   * past-due 'sent' invoices to 'overdue'. Generation is idempotent (drafts only —
   * nothing is charged automatically), so re-running is safe and also catches
   * tenants that became active mid-month. Opt out with PLATFORM_INVOICE_AUTOGEN=false.
   */
  onModuleInit(): void {
    if (process.env.PLATFORM_INVOICE_AUTOGEN === 'false') {
      this.logger.log('Auto invoice generation disabled (PLATFORM_INVOICE_AUTOGEN=false).');
      return;
    }
    void this.runBillingJob().catch((e) => this.logger.warn(`initial billing job failed: ${e}`));
    setInterval(() => {
      void this.runBillingJob().catch((e) => this.logger.warn(`billing job failed: ${e}`));
    }, INVOICE_JOB_INTERVAL_MS).unref?.();
  }

  /** Current billing period in 'YYYY-MM' (server clock). */
  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async runBillingJob(): Promise<{ created: number; overdue: number }> {
    // Fast in-process guard, then a cross-connection/instance advisory lock so
    // the job never double-runs (overlapping timers or multiple backends).
    if (this.running) return { created: 0, overdue: 0 };
    this.running = true;
    const client = await this.pool.connect();
    try {
      const locked = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [BILLING_LOCK_KEY]);
      if (!locked.rows[0]?.locked) return { created: 0, overdue: 0 };
      try {
        const started = Date.now();
        const gen = await this.generate(this.currentPeriod());
        const overdue = await this.markOverdue();
        const dun = await this.enforceDunning();
        if (gen.created > 0 || overdue > 0 || dun.pastDue > 0 || dun.suspended > 0) {
          this.logger.log(
            `Billing job: ${gen.created} draft(s) created, ${overdue} overdue, ` +
            `${dun.pastDue} flagged past_due, ${dun.suspended} auto-suspended.`,
          );
        }
        void this.jobMonitor?.recordRun('platform-billing', {
          label: 'Platform billing & dunning',
          status: 'ok',
          durationMs: Date.now() - started,
          intervalMs: INVOICE_JOB_INTERVAL_MS,
          detail: `${gen.created} draft(s), ${overdue} overdue, ${dun.pastDue} past_due, ${dun.suspended} suspended`,
        });
        return { created: gen.created, overdue };
      } catch (e) {
        void this.jobMonitor?.recordRun('platform-billing', {
          label: 'Platform billing & dunning',
          status: 'error',
          intervalMs: INVOICE_JOB_INTERVAL_MS,
          detail: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [BILLING_LOCK_KEY]);
      }
    } finally {
      client.release();
      this.running = false;
    }
  }

  /**
   * Dunning: escalate tenants with overdue invoices along active → past_due →
   * suspended, based on how many days their OLDEST overdue invoice is past due.
   * This is what makes an unpaid invoice actually bite — an overdue row that
   * triggers nothing is just a spreadsheet cell. Escalation only (never softens a
   * status); reactivation happens on payment (see maybeReactivateOnPayment).
   *
   * NOTE: this collects the debt-lifecycle side of billing. Actually CHARGING a
   * card is a separate integration (Midtrans/Xendit/Stripe) — the seam is
   * updateStatus(id,'paid'), which a gateway webhook would call. Until that lands,
   * an operator marks invoices paid manually and this loop does the rest.
   */
  async enforceDunning(): Promise<{ pastDue: number; suspended: number }> {
    const graceDays = this.graceDays();
    const suspendDays = this.suspendDays();
    const rows = await this.pool.query<{ tenant_id: string; status: string; oldest_due: string | null }>(
      `SELECT t.id AS tenant_id, t.status, MIN(i.due_date) AS oldest_due
         FROM platform_invoices i
         JOIN tenants t ON t.id = i.tenant_id
        WHERE i.status = 'overdue' AND t.status IN ('active','past_due')
        GROUP BY t.id, t.status`,
    );
    let pastDue = 0;
    let suspended = 0;
    for (const r of rows.rows) {
      if (!r.oldest_due) continue;
      const ageDays = Math.floor((Date.now() - new Date(r.oldest_due).getTime()) / MS_PER_DAY);
      if (suspendDays > 0 && ageDays >= suspendDays) {
        await this.lifecycle.suspend(r.tenant_id, { reason: `Auto-suspended — invoice ${ageDays}d overdue`, source: 'billing' });
        suspended++;
      } else if (graceDays > 0 && ageDays >= graceDays && r.status === 'active') {
        await this.lifecycle.markPastDue(r.tenant_id, { reason: `Invoice ${ageDays}d overdue`, source: 'billing' });
        pastDue++;
      }
    }
    return { pastDue, suspended };
  }

  /**
   * When a tenant clears all outstanding invoices, restore it — but ONLY if it was
   * billing that suspended/flagged it (never override an admin's manual suspension).
   */
  private async maybeReactivateOnPayment(tenantId: string): Promise<void> {
    const owed = await this.pool.query(
      `SELECT 1 FROM platform_invoices WHERE tenant_id = $1 AND status IN ('overdue','sent') LIMIT 1`,
      [tenantId],
    );
    if ((owed.rowCount ?? 0) > 0) return;
    const t = await this.pool.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
    const st = t.rows[0]?.status;
    if (st !== 'past_due' && st !== 'suspended') return;
    const last = await this.pool.query<{ source: string }>(
      `SELECT source FROM tenant_status_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (last.rows[0]?.source !== 'billing') return; // an admin suspended this tenant — leave it
    await this.lifecycle.reactivate(tenantId, { reason: 'Payment received — no outstanding invoices', source: 'billing' });
  }

  /** Flip 'sent' invoices past their due date to 'overdue'. Returns rows changed. */
  async markOverdue(): Promise<number> {
    const r = await this.pool.query(
      `UPDATE platform_invoices
         SET status = 'overdue', updated_at = NOW()
         WHERE status = 'sent' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`,
    );
    return r.rowCount ?? 0;
  }

  async list(filters: InvoiceListFilters = {}): Promise<PlatformInvoice[]> {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (filters.status) { vals.push(filters.status); where.push(`i.status = $${vals.length}`); }
    if (filters.tenantId) { vals.push(filters.tenantId); where.push(`i.tenant_id = $${vals.length}`); }
    if (filters.period) { vals.push(filters.period); where.push(`i.period = $${vals.length}`); }
    const r = await this.pool.query<InvoiceRow>(
      `SELECT i.*, t.name AS tenant_name
         FROM platform_invoices i
         LEFT JOIN tenants t ON t.id = i.tenant_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY i.period DESC, t.name ASC`,
      vals,
    );
    return r.rows.map((row) => this.map(row));
  }

  /** Headline numbers for the Billing page: outstanding, overdue, paid this month. */
  async summary(): Promise<{ outstanding: number; overdue: number; paidThisMonth: number; countByStatus: Record<InvoiceStatus, number> }> {
    const r = await this.pool.query<{ status: InvoiceStatus; n: string; amount: string }>(
      `SELECT status, COUNT(*)::text AS n, COALESCE(SUM(amount),0)::text AS amount
         FROM platform_invoices GROUP BY status`,
    );
    const countByStatus = { draft: 0, sent: 0, paid: 0, overdue: 0, void: 0 } as Record<InvoiceStatus, number>;
    let outstanding = 0;
    let overdue = 0;
    for (const row of r.rows) {
      countByStatus[row.status] = parseInt(row.n, 10);
      if (row.status === 'sent' || row.status === 'overdue') outstanding += parseFloat(row.amount);
      if (row.status === 'overdue') overdue += parseFloat(row.amount);
    }
    const paidRow = await this.pool.query<{ amount: string }>(
      `SELECT COALESCE(SUM(amount),0)::text AS amount FROM platform_invoices
         WHERE status='paid' AND paid_at >= date_trunc('month', NOW())`,
    );
    return { outstanding, overdue, paidThisMonth: parseFloat(paidRow.rows[0]!.amount), countByStatus };
  }

  /**
   * Generate draft invoices for a period ('YYYY-MM') for every active tenant that
   * doesn't already have one. Amount = the tenant's plan monthly-equivalent price.
   * Idempotent via the (tenant_id, period) unique constraint. Returns how many
   * were created and skipped.
   */
  async generate(period: string): Promise<{ created: number; skipped: number }> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequestException('Period must be YYYY-MM');
    const priceByCode = await this.plans.monthlyPriceByCode();
    const tenants = await this.pool.query<{ id: string; plan: string | null }>(
      `SELECT id, plan FROM tenants WHERE status = 'active'`,
    );
    // 15th of the invoice month as a reasonable default due date.
    const dueDate = `${period}-15`;
    let created = 0;
    let skipped = 0;
    for (const tnt of tenants.rows) {
      const amount = priceByCode.get(tnt.plan ?? '') ?? 0;
      const { rate, taxAmount } = await this.tax.computeTax(amount);
      const res = await this.pool.query(
        `INSERT INTO platform_invoices (tenant_id, period, plan_code, amount, tax_rate, tax_amount, due_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, period) DO NOTHING`,
        [tnt.id, period, tnt.plan, amount, rate, taxAmount, dueDate],
      );
      if (res.rowCount && res.rowCount > 0) created++; else skipped++;
    }
    return { created, skipped };
  }

  async updateStatus(id: string, status: InvoiceStatus): Promise<PlatformInvoice> {
    if (!STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    // Stamp the lifecycle timestamps as the status advances.
    const issued = status === 'sent' || status === 'overdue' || status === 'paid' ? 'COALESCE(issued_at, NOW())' : 'issued_at';
    const paid = status === 'paid' ? 'NOW()' : status === 'void' || status === 'draft' ? 'NULL' : 'paid_at';
    const r = await this.pool.query<InvoiceRow>(
      `UPDATE platform_invoices
         SET status = $1, issued_at = ${issued}, paid_at = ${paid}, updated_at = NOW()
         WHERE id = $2
         RETURNING *, (SELECT name FROM tenants WHERE id = tenant_id) AS tenant_name`,
      [status, id],
    );
    if (r.rows.length === 0) throw new NotFoundException('Invoice not found');
    let invoice = this.map(r.rows[0]!);
    // Issue a Faktur Pajak number when the invoice is first issued/paid (no-op if
    // tax is disabled or a number already exists).
    if ((status === 'sent' || status === 'overdue' || status === 'paid') && !invoice.fakturNumber) {
      const faktur = await this.tax.issueFaktur(id).catch(() => null);
      if (faktur) invoice = { ...invoice, fakturNumber: faktur };
    }
    // Clearing the last outstanding invoice restores a billing-suspended tenant.
    if (status === 'paid' || status === 'void') {
      await this.maybeReactivateOnPayment(invoice.tenantId).catch((e) =>
        this.logger.warn(`reactivate-on-payment failed for ${invoice.tenantId}: ${e}`),
      );
    }
    // Subscription revenue collected — surface on the domain bus for the AI feed /
    // billing analytics (a real platform-ledger money movement).
    if (status === 'paid') {
      void this.eventBus?.emit({
        type: DomainEventType.SubscriptionInvoicePaid,
        tenantId: invoice.tenantId, actor: 'admin',
        payload: { invoiceId: invoice.id, period: invoice.period, planCode: invoice.planCode, amount: invoice.amount },
      });
    }
    return invoice;
  }

  async update(id: string, dto: { amount?: number; dueDate?: string | null; notes?: string | null }): Promise<PlatformInvoice> {
    const set: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (dto.amount !== undefined) {
      if (dto.amount < 0) throw new BadRequestException('Amount must be >= 0');
      set.push(`amount = $${i++}`); vals.push(dto.amount);
    }
    if (dto.dueDate !== undefined) { set.push(`due_date = $${i++}`); vals.push(dto.dueDate); }
    if (dto.notes !== undefined) { set.push(`notes = $${i++}`); vals.push(dto.notes); }
    if (set.length === 0) throw new BadRequestException('Nothing to update');
    set.push('updated_at = NOW()');
    vals.push(id);
    const r = await this.pool.query<InvoiceRow>(
      `UPDATE platform_invoices SET ${set.join(', ')} WHERE id = $${i}
         RETURNING *, (SELECT name FROM tenants WHERE id = tenant_id) AS tenant_name`,
      vals,
    );
    if (r.rows.length === 0) throw new NotFoundException('Invoice not found');
    return this.map(r.rows[0]!);
  }

  private map(row: InvoiceRow): PlatformInvoice {
    const amount = parseFloat(row.amount);
    const taxAmount = row.tax_amount != null ? parseFloat(row.tax_amount) : 0;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      period: row.period,
      planCode: row.plan_code,
      amount,
      taxRate: row.tax_rate != null ? parseFloat(row.tax_rate) : 0,
      taxAmount,
      total: Math.round((amount + taxAmount) * 100) / 100,
      fakturNumber: row.faktur_number,
      currency: row.currency,
      status: row.status,
      issuedAt: row.issued_at,
      dueDate: row.due_date,
      paidAt: row.paid_at,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
