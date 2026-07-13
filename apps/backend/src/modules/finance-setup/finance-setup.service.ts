import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { AccountingService } from '../accounting/accounting.service';
import { AccountingPoster } from '../accounting/accounting-poster.service';
import { PayrollService } from '../hr/payroll.service';
import { ACC } from '../accounting/chart-of-accounts.defaults';

export interface FinanceSettings {
  payrollWorkingDays: number;
  payrollPayDay: number;
  autoRunPayroll: boolean;
  autoCloseBooks: boolean;
  taxEnabled: boolean;
  taxRate: number;
  openingBalancesPosted: boolean;
  provisionedAt: string | null;
}
export interface FinanceSettingsPatch {
  payrollWorkingDays?: number;
  payrollPayDay?: number;
  autoRunPayroll?: boolean;
  autoCloseBooks?: boolean;
  taxEnabled?: boolean;
  taxRate?: number;
}
export interface OpeningBalances { cash?: number; bank?: number; inventory?: number }

const DEFAULTS: FinanceSettings = {
  payrollWorkingDays: 26, payrollPayDay: 25, autoRunPayroll: false, autoCloseBooks: false,
  taxEnabled: false, taxRate: 11, openingBalancesPosted: false, provisionedAt: null,
};

const period = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const priorPeriod = (d: Date) => { const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); return period(p); };

/**
 * FinanceSetupService — one-click Finance/HR provisioning + automation for small
 * teams. Owns per-tenant defaults (tenant_finance_settings), a `provision` that
 * makes the books usable in one call (seed chart of accounts → opening balances →
 * backfill postings), and an opt-in daily ticker that runs payroll on pay-day and
 * closes the prior month — so a customer with no finance staff doesn't have to.
 *
 * Self-contained (own table + own timer, mirroring membership-lifecycle) so it
 * plugs into any onboarding flow without touching the shared settings module.
 */
@Injectable()
export class FinanceSetupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinanceSetupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly accounting: AccountingService,
    private readonly poster: AccountingPoster,
    private readonly payroll: PayrollService,
  ) {}

  onModuleInit(): void {
    // Self-owned automation heartbeat (single-node, in-memory — same pattern as
    // membership-lifecycle). Runs a few times a day; all actions are idempotent.
    if (process.env.DISABLE_FINANCE_AUTOMATION === 'true') return;
    this.timer = setInterval(() => { void this.runAutomationAllTenants(); }, 6 * 60 * 60 * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  // ─── Settings ─────────────────────────────────────────────────────────
  async getSettings(tenantId: string): Promise<FinanceSettings> {
    const res = await this.pool.query(`SELECT * FROM tenant_finance_settings WHERE tenant_id = $1`, [tenantId]);
    if (res.rows.length === 0) return { ...DEFAULTS };
    return this.map(res.rows[0]);
  }

  async updateSettings(tenantId: string, patch: FinanceSettingsPatch): Promise<FinanceSettings> {
    const cur = await this.ensureRow(tenantId);
    const next = {
      payrollWorkingDays: patch.payrollWorkingDays ?? cur.payrollWorkingDays,
      payrollPayDay: patch.payrollPayDay ?? cur.payrollPayDay,
      autoRunPayroll: patch.autoRunPayroll ?? cur.autoRunPayroll,
      autoCloseBooks: patch.autoCloseBooks ?? cur.autoCloseBooks,
      taxEnabled: patch.taxEnabled ?? cur.taxEnabled,
      taxRate: patch.taxRate ?? cur.taxRate,
    };
    const res = await this.pool.query(
      `UPDATE tenant_finance_settings
       SET payroll_working_days=$2, payroll_pay_day=$3, auto_run_payroll=$4, auto_close_books=$5,
           tax_enabled=$6, tax_rate=$7, updated_at=NOW()
       WHERE tenant_id=$1 RETURNING *`,
      [tenantId, next.payrollWorkingDays, next.payrollPayDay, next.autoRunPayroll, next.autoCloseBooks, next.taxEnabled, next.taxRate],
    );
    return this.map(res.rows[0]);
  }

  private async ensureRow(tenantId: string): Promise<FinanceSettings> {
    await this.pool.query(
      `INSERT INTO tenant_finance_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );
    return this.getSettings(tenantId);
  }

  /** Default working-days for payroll, read by the payroll one-click. */
  async workingDays(tenantId: string): Promise<number> {
    return (await this.getSettings(tenantId)).payrollWorkingDays;
  }

  // ─── One-click provisioning ───────────────────────────────────────────
  /**
   * Make the books usable in one call: seed the chart of accounts, record opening
   * balances (once), and backfill postings for existing operations. Idempotent.
   */
  async provision(tenantId: string, opening: OpeningBalances | undefined, userId: string, now: Date): Promise<Record<string, unknown>> {
    await this.ensureRow(tenantId);
    const seeded = await this.accounting.seedDefaults(tenantId);
    const openingResult = await this.postOpeningBalances(tenantId, opening, userId);
    // Backfill the last 90 days of operations into the ledger.
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const synced = await this.poster.sync(tenantId, from, to);
    await this.pool.query(`UPDATE tenant_finance_settings SET provisioned_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
    return { seededAccounts: seeded.seeded, openingBalances: openingResult, synced };
  }

  /** Post the starting balances as one entry: Dr assets / Cr Owner's Equity. Once only. */
  async postOpeningBalances(tenantId: string, opening: OpeningBalances | undefined, userId: string): Promise<{ posted: boolean; total: number }> {
    if (!opening) return { posted: false, total: 0 };
    const cur = await this.getSettings(tenantId);
    if (cur.openingBalancesPosted) return { posted: false, total: 0 };
    const parts: { code: string; amount: number }[] = [
      { code: ACC.CASH, amount: Number(opening.cash) || 0 },
      { code: ACC.BANK, amount: Number(opening.bank) || 0 },
      { code: ACC.INVENTORY, amount: Number(opening.inventory) || 0 },
    ].filter((p) => p.amount > 0);
    const total = parts.reduce((s, p) => s + p.amount, 0);
    if (total <= 0) return { posted: false, total: 0 };
    const lines = [
      ...parts.map((p) => ({ accountCode: p.code, debit: p.amount, memo: 'Opening balance' })),
      { accountCode: ACC.OWNER_EQUITY, credit: total, memo: 'Opening balance — capital' },
    ];
    await this.accounting.postEntry(tenantId, { memo: 'Opening balances', sourceType: 'opening_balance', sourceId: null, lines, createdBy: userId });
    await this.pool.query(`UPDATE tenant_finance_settings SET opening_balances_posted = true, updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
    return { posted: true, total };
  }

  /** Setup checklist for the onboarding UI. */
  async status(tenantId: string): Promise<Record<string, unknown>> {
    const s = await this.getSettings(tenantId);
    const [coa, emp, runs] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS n FROM chart_of_accounts WHERE tenant_id = $1`, [tenantId]),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE tenant_id = $1 AND status = 'active'`, [tenantId]),
      this.pool.query(`SELECT COUNT(*)::int AS n FROM payroll_runs WHERE tenant_id = $1 AND status = 'finalized'`, [tenantId]),
    ]);
    return {
      settings: s,
      checklist: {
        chartOfAccounts: (coa.rows[0].n as number) > 0,
        openingBalances: s.openingBalancesPosted,
        employeesAdded: (emp.rows[0].n as number) > 0,
        payrollRun: (runs.rows[0].n as number) > 0,
        provisioned: s.provisionedAt != null,
      },
      counts: { accounts: coa.rows[0].n, activeEmployees: emp.rows[0].n, finalizedPayrollRuns: runs.rows[0].n },
    };
  }

  // ─── Automation ───────────────────────────────────────────────────────
  /** Run pay-day payroll + prior-month close for one tenant per its settings. Idempotent. */
  async runAutomation(tenantId: string, now: Date, actor = 'system'): Promise<Record<string, unknown>> {
    const s = await this.getSettings(tenantId);
    const actions: string[] = [];

    if (s.autoRunPayroll && now.getDate() >= s.payrollPayDay) {
      const p = period(now);
      const existing = await this.pool.query<{ status: string }>(
        `SELECT status FROM payroll_runs WHERE tenant_id = $1 AND period = $2`, [tenantId, p],
      );
      const finalized = existing.rows.some((r) => r.status === 'finalized');
      if (!finalized) {
        const run = await this.payroll.generatePayroll(tenantId, p, s.payrollWorkingDays, actor);
        await this.payroll.finalize(tenantId, run.id as string, actor);
        actions.push(`payroll ${p} generated + finalized`);
      }
    }

    if (s.autoCloseBooks) {
      const pp = priorPeriod(now);
      const closed = await this.pool.query<{ status: string }>(
        `SELECT status FROM accounting_periods WHERE tenant_id = $1 AND period = $2`, [tenantId, pp],
      );
      if (closed.rows[0]?.status !== 'closed') {
        await this.accounting.setPeriod(tenantId, pp, 'closed', actor);
        actions.push(`period ${pp} closed`);
      }
    }
    return { tenantId, actions };
  }

  /** Sweep every tenant that opted into automation (called by the ticker). */
  async runAutomationAllTenants(now: Date = new Date()): Promise<void> {
    try {
      const res = await this.pool.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM tenant_finance_settings WHERE auto_run_payroll = true OR auto_close_books = true`,
      );
      for (const r of res.rows) {
        try { await this.runAutomation(r.tenant_id, now); }
        catch (e) { this.logger.warn(`automation failed for ${r.tenant_id}: ${e instanceof Error ? e.message : e}`); }
      }
    } catch (e) {
      this.logger.error(`automation sweep failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private map(r: Record<string, unknown>): FinanceSettings {
    return {
      payrollWorkingDays: Number(r.payroll_working_days),
      payrollPayDay: Number(r.payroll_pay_day),
      autoRunPayroll: !!r.auto_run_payroll,
      autoCloseBooks: !!r.auto_close_books,
      taxEnabled: !!r.tax_enabled,
      taxRate: parseFloat(String(r.tax_rate)),
      openingBalancesPosted: !!r.opening_balances_posted,
      provisionedAt: (r.provisioned_at as string) ?? null,
    };
  }
}
