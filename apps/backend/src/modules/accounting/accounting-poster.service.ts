import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { AccountingService, type JournalLineInput } from './accounting.service';
import { ACC } from './chart-of-accounts.defaults';

/**
 * Turns money events into double-entry journal entries. Subscribes to the
 * in-process event bus for order-paid, expense-recorded and payroll-finalized,
 * and posts a balanced entry for each. Posting is idempotent per source row, so:
 *   - a duplicate event is harmless, and
 *   - because events are fire-and-forget (a process restart between COMMIT and
 *     emit can drop one), `sync()` can backfill any missing entries from the
 *     operational tables for a period.
 * A posting failure is logged and swallowed — it must never affect the POS/order
 * transaction (which has already committed).
 */
@Injectable()
export class AccountingPoster implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountingPoster.name);
  private unsubscribes: Array<() => void> = [];

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly accounting: AccountingService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.eventBus) return;
    this.unsubscribes.push(
      this.eventBus.on(DomainEventType.OrderPaid, (e) => this.safe(() => this.postOrder(e.tenantId!, (e.payload as { orderId: string }).orderId))),
      this.eventBus.on(DomainEventType.OrderVoided, (e) => this.safe(() => this.postOrderVoid(e.tenantId!, (e.payload as { orderId: string; wasPaid: boolean }).orderId, (e.payload as { wasPaid: boolean }).wasPaid))),
      this.eventBus.on(DomainEventType.RefundIssued, (e) => this.safe(() => this.postRefund(e.tenantId!, (e.payload as { refundId: string }).refundId))),
      this.eventBus.on(DomainEventType.ExpenseRecorded, (e) => this.safe(() => this.postExpense(e.tenantId!, (e.payload as { expenseId: string }).expenseId))),
      this.eventBus.on(DomainEventType.PayrollFinalized, (e) => this.safe(() => this.postPayrollRun(e.tenantId!, (e.payload as { runId: string }).runId))),
      this.eventBus.on(DomainEventType.SettlementAccrued, (e) => this.safe(() => this.postSettlementAccrual(e.tenantId!, (e.payload as { entryId: string }).entryId))),
      this.eventBus.on(DomainEventType.SettlementPaidOut, (e) => this.safe(() => this.postSettlementPayout(e.tenantId!, (e.payload as { payoutId: string }).payoutId))),
      this.eventBus.on(DomainEventType.StockOpnameClosed, (e) => this.safe(() => this.postOpname(e.tenantId!, (e.payload as { opnameId: string }).opnameId))),
    );
    this.logger.log('Accounting auto-posting subscribed (order.paid, expense, payroll.finalized, settlement, opname)');
  }

  onModuleDestroy(): void {
    this.unsubscribes.forEach((u) => u());
    this.unsubscribes = [];
  }

  private async safe(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.logger.error(`Auto-post failed: ${e instanceof Error ? e.message : e}`); }
  }

  /** Cash-like tender posts to Cash; everything else (card/transfer/QRIS/EDC) to Bank. */
  private cashOrBank(method: string | null | undefined): string {
    return (method ?? 'cash').toLowerCase() === 'cash' ? ACC.CASH : ACC.BANK;
  }

  // ─── Posters (read from DB → idempotent postEntry) ───────────────────────

  /** Sale: Dr Cash/Bank + Cr Sales, and (if any COGS) Dr COGS + Cr Inventory. */
  async postOrder(tenantId: string, orderId: string): Promise<boolean> {
    const ord = await this.pool.query<{ total: string; tax: string | null; outlet_id: string | null; payment_method: string | null; status: string; created_at: string }>(
      `SELECT total, tax, outlet_id, payment_method, status, created_at FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    if (ord.rows.length === 0) return false;
    const o = ord.rows[0]!;
    if (!['paid', 'confirmed', 'completed'].includes(o.status)) return false; // only booked revenue
    const total = parseFloat(o.total);
    if (!(total > 0)) return false;
    // PPN collected is a liability, not revenue — split it out of the sale total.
    const tax = Math.min(parseFloat(o.tax ?? '0') || 0, total);
    const cogsRes = await this.pool.query<{ cogs: string }>(
      `SELECT COALESCE(SUM(cost_snapshot * quantity),0) AS cogs FROM order_items WHERE order_id = $1`,
      [orderId],
    );
    const cogs = parseFloat(cogsRes.rows[0]!.cogs) || 0;
    const date = new Date(o.created_at).toISOString().slice(0, 10);
    const lines: JournalLineInput[] = [
      { accountCode: this.cashOrBank(o.payment_method), debit: total, memo: 'Sale' },
      { accountCode: ACC.SALES, credit: total - tax, memo: 'Sale revenue' },
    ];
    if (tax > 0) lines.push({ accountCode: ACC.TAX_PAYABLE, credit: tax, memo: 'PPN collected' });
    if (cogs > 0) {
      lines.push({ accountCode: ACC.COGS, debit: cogs, memo: 'Cost of goods sold' });
      lines.push({ accountCode: ACC.INVENTORY, credit: cogs, memo: 'Inventory consumed' });
    }
    const res = await this.accounting.postEntry(tenantId, {
      entryDate: date, outletId: o.outlet_id, memo: 'POS sale', sourceType: 'order', sourceId: orderId, lines,
    });
    return !res.skipped;
  }

  /**
   * Post a refund. Reverses the refunded portion of a sale (dated today — reversals
   * belong in the current open period): Dr Sales (net) + Dr Tax Payable (PPN) / Cr
   * Cash|Bank (gross), and Dr Inventory / Cr COGS for the proportionally restocked
   * cost. Idempotent per refund id (sourceType='refund').
   */
  async postRefund(tenantId: string, refundId: string): Promise<boolean> {
    const rf = await this.pool.query<{
      order_id: string; outlet_id: string | null; total: string; tax_reversed: string; refund_method: string;
    }>(
      `SELECT order_id, outlet_id, total, tax_reversed, refund_method FROM refunds WHERE id = $1 AND tenant_id = $2`,
      [refundId, tenantId],
    );
    if (rf.rows.length === 0) return false;
    const r = rf.rows[0]!;
    const total = parseFloat(r.total) || 0;
    if (!(total > 0)) return false;
    const tax = Math.min(parseFloat(r.tax_reversed ?? '0') || 0, total);

    // Proportional COGS: original order COGS × (refund total / order total).
    const ord = await this.pool.query<{ total: string }>(
      `SELECT total FROM orders WHERE id = $1 AND tenant_id = $2`,
      [r.order_id, tenantId],
    );
    const orderTotal = parseFloat(ord.rows[0]?.total ?? '0') || 0;
    const fraction = orderTotal > 0 ? Math.min(total / orderTotal, 1) : 0;
    const cogsRes = await this.pool.query<{ cogs: string }>(
      `SELECT COALESCE(SUM(cost_snapshot * quantity),0) AS cogs FROM order_items WHERE order_id = $1`,
      [r.order_id],
    );
    const cogs = Math.round((parseFloat(cogsRes.rows[0]!.cogs) || 0) * fraction * 100) / 100;

    const lines: JournalLineInput[] = [
      { accountCode: ACC.SALES, debit: total - tax, memo: 'Refund — reverse revenue' },
      { accountCode: this.cashOrBank(r.refund_method), credit: total, memo: 'Refund — cash out' },
    ];
    if (tax > 0) lines.push({ accountCode: ACC.TAX_PAYABLE, debit: tax, memo: 'Refund — reverse PPN' });
    if (cogs > 0) {
      lines.push({ accountCode: ACC.INVENTORY, debit: cogs, memo: 'Refund — restock' });
      lines.push({ accountCode: ACC.COGS, credit: cogs, memo: 'Refund — reverse COGS' });
    }
    const res = await this.accounting.postEntry(tenantId, {
      outletId: r.outlet_id, memo: 'POS refund', sourceType: 'refund', sourceId: refundId, lines,
    });
    return !res.skipped;
  }

  /**
   * Reverse a voided sale. Posts a mirror of the original sale entry (dated today
   * — reversals belong in the current open period, not the original) and reverses
   * any inter-branch settlement accrual whose entry the void voided. Idempotent.
   */
  async postOrderVoid(tenantId: string, orderId: string, wasPaid: boolean): Promise<boolean> {
    if (!wasPaid) return false; // only paid orders were ever booked
    const ord = await this.pool.query<{ total: string; tax: string | null; outlet_id: string | null; payment_method: string | null }>(
      `SELECT total, tax, outlet_id, payment_method FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    if (ord.rows.length === 0) return false;
    const o = ord.rows[0]!;
    const total = parseFloat(o.total);
    const tax = Math.min(parseFloat(o.tax ?? '0') || 0, total);
    const cogsRes = await this.pool.query<{ cogs: string }>(
      `SELECT COALESCE(SUM(cost_snapshot * quantity),0) AS cogs FROM order_items WHERE order_id = $1`,
      [orderId],
    );
    const cogs = parseFloat(cogsRes.rows[0]!.cogs) || 0;
    let posted = false;
    if (total > 0) {
      // Mirror the sale, including the PPN split.
      const lines: JournalLineInput[] = [
        { accountCode: ACC.SALES, debit: total - tax, memo: 'Void sale — reverse revenue' },
        { accountCode: this.cashOrBank(o.payment_method), credit: total, memo: 'Void sale — reverse cash' },
      ];
      if (tax > 0) lines.push({ accountCode: ACC.TAX_PAYABLE, debit: tax, memo: 'Void sale — reverse PPN' });
      if (cogs > 0) {
        // Void restocks inventory, so mirror: Dr Inventory / Cr COGS.
        lines.push({ accountCode: ACC.INVENTORY, debit: cogs, memo: 'Void sale — restock' });
        lines.push({ accountCode: ACC.COGS, credit: cogs, memo: 'Void sale — reverse COGS' });
      }
      const res = await this.accounting.postEntry(tenantId, {
        outletId: o.outlet_id, memo: 'Void POS sale', sourceType: 'order_void', sourceId: orderId, lines,
      });
      posted = !res.skipped;
    }
    // Reverse any inter-branch settlement accrual for entries the void voided.
    const se = await this.pool.query<{ id: string; owing_outlet_id: string; serving_outlet_id: string; amount: string }>(
      `SELECT se.id, se.owing_outlet_id, se.serving_outlet_id, se.amount
       FROM settlement_entries se JOIN membership_usages mu ON mu.id = se.usage_id
       WHERE mu.order_id = $1 AND se.tenant_id = $2 AND se.status = 'void'`,
      [orderId, tenantId],
    );
    for (const s of se.rows) {
      const amt = parseFloat(s.amount);
      if (!(amt > 0)) continue;
      const r1 = await this.accounting.postEntry(tenantId, {
        outletId: s.serving_outlet_id, memo: 'Void inter-branch accrual', sourceType: 'settle_void_r', sourceId: s.id,
        lines: [{ accountCode: ACC.INTERBRANCH_INCOME, debit: amt }, { accountCode: ACC.INTERBRANCH_RECEIVABLE, credit: amt }],
      });
      const r2 = await this.accounting.postEntry(tenantId, {
        outletId: s.owing_outlet_id, memo: 'Void inter-branch accrual', sourceType: 'settle_void_p', sourceId: s.id,
        lines: [{ accountCode: ACC.INTERBRANCH_PAYABLE, debit: amt }, { accountCode: ACC.INTERBRANCH_CHARGE, credit: amt }],
      });
      posted = posted || !r1.skipped || !r2.skipped;
    }
    return posted;
  }

  /** Expense: Dr Operating Expenses + Cr Cash/Bank. */
  async postExpense(tenantId: string, expenseId: string): Promise<boolean> {
    const exp = await this.pool.query<{ amount: string; category: string; outlet_id: string | null; payment_method: string | null; expense_date: string }>(
      `SELECT amount, category, outlet_id, payment_method, expense_date FROM expenses WHERE id = $1 AND tenant_id = $2`,
      [expenseId, tenantId],
    );
    if (exp.rows.length === 0) return false;
    const e = exp.rows[0]!;
    const amount = parseFloat(e.amount);
    if (!(amount > 0)) return false;
    const date = new Date(e.expense_date).toISOString().slice(0, 10);
    const res = await this.accounting.postEntry(tenantId, {
      entryDate: date, outletId: e.outlet_id, memo: `Expense: ${e.category}`, sourceType: 'expense', sourceId: expenseId,
      lines: [
        { accountCode: ACC.OPEX, debit: amount, memo: e.category },
        { accountCode: this.cashOrBank(e.payment_method), credit: amount, memo: e.category },
      ],
    });
    return !res.skipped;
  }

  /** Finalized payroll run: Dr Salaries & Wages + Cr Cash (net pay disbursed). */
  async postPayrollRun(tenantId: string, runId: string): Promise<boolean> {
    const run = await this.pool.query<{ period: string; status: string; total_net: string }>(
      `SELECT period, status, total_net FROM payroll_runs WHERE id = $1 AND tenant_id = $2`,
      [runId, tenantId],
    );
    if (run.rows.length === 0) return false;
    const r = run.rows[0]!;
    if (r.status !== 'finalized') return false; // only book finalized payroll
    const net = parseFloat(r.total_net);
    if (!(net > 0)) return false;
    const res = await this.accounting.postEntry(tenantId, {
      entryDate: `${r.period}-01`, outletId: null, memo: `Payroll ${r.period}`, sourceType: 'payroll', sourceId: runId,
      lines: [
        { accountCode: ACC.SALARIES, debit: net, memo: `Payroll ${r.period}` },
        { accountCode: ACC.CASH, credit: net, memo: `Payroll ${r.period}` },
      ],
    });
    return !res.skipped;
  }

  /**
   * Inter-branch settlement ACCRUAL (at wash time). Two per-branch entries that
   * net to zero across the tenant: the serving branch earns Inter-branch Income
   * (Dr Receivable / Cr Income) and the home branch takes an Inter-branch Charge
   * (Dr Charge / Cr Payable). Revenue/COGS for the wash were already booked at the
   * operating branch via the order — this only redistributes the settlement amount.
   */
  async postSettlementAccrual(tenantId: string, entryId: string): Promise<boolean> {
    const row = await this.pool.query<{ owing_outlet_id: string; serving_outlet_id: string; amount: string; created_at: string }>(
      `SELECT owing_outlet_id, serving_outlet_id, amount, created_at FROM settlement_entries WHERE id = $1 AND tenant_id = $2`,
      [entryId, tenantId],
    );
    if (row.rows.length === 0) return false;
    const s = row.rows[0]!;
    const amount = parseFloat(s.amount);
    if (!(amount > 0)) return false;
    const date = new Date(s.created_at).toISOString().slice(0, 10);
    // Serving branch: earns the settlement.
    const r1 = await this.accounting.postEntry(tenantId, {
      entryDate: date, outletId: s.serving_outlet_id, memo: 'Inter-branch settlement (earned)',
      sourceType: 'settle_accrue_r', sourceId: entryId,
      lines: [
        { accountCode: ACC.INTERBRANCH_RECEIVABLE, debit: amount, memo: 'Due from home branch' },
        { accountCode: ACC.INTERBRANCH_INCOME, credit: amount, memo: 'Inter-branch income' },
      ],
    });
    // Home branch: owes the settlement.
    const r2 = await this.accounting.postEntry(tenantId, {
      entryDate: date, outletId: s.owing_outlet_id, memo: 'Inter-branch settlement (owed)',
      sourceType: 'settle_accrue_p', sourceId: entryId,
      lines: [
        { accountCode: ACC.INTERBRANCH_CHARGE, debit: amount, memo: 'Inter-branch charge' },
        { accountCode: ACC.INTERBRANCH_PAYABLE, credit: amount, memo: 'Due to serving branch' },
      ],
    });
    return !r1.skipped || !r2.skipped;
  }

  /**
   * Inter-branch settlement PAYOUT (cash changes hands). Clears the accrued
   * receivable/payable and books the cash movement per branch. Works for a normal
   * one-direction payout and a net-off (which settles entries in both directions):
   * for each of the two branches we net its payable (as owing side) against its
   * receivable (as serving side) and post the balancing cash line.
   */
  async postSettlementPayout(tenantId: string, payoutId: string): Promise<boolean> {
    const p = await this.pool.query<{ owing_outlet_id: string; serving_outlet_id: string; created_at: string }>(
      `SELECT owing_outlet_id, serving_outlet_id, created_at FROM settlement_payouts WHERE id = $1 AND tenant_id = $2`,
      [payoutId, tenantId],
    );
    if (p.rows.length === 0) return false;
    const date = new Date(p.rows[0]!.created_at).toISOString().slice(0, 10);
    // Gross settled per direction, from the entries this payout discharged.
    const entries = await this.pool.query<{ owing_outlet_id: string; serving_outlet_id: string; amount: string }>(
      `SELECT owing_outlet_id, serving_outlet_id, amount FROM settlement_entries WHERE payout_id = $1 AND tenant_id = $2`,
      [payoutId, tenantId],
    );
    if (entries.rows.length === 0) return false;
    const branches = [
      { id: p.rows[0]!.owing_outlet_id, sourceType: 'settle_payout_a' },
      { id: p.rows[0]!.serving_outlet_id, sourceType: 'settle_payout_b' },
    ];
    let posted = false;
    for (const b of branches) {
      const payable = entries.rows.filter((e) => e.owing_outlet_id === b.id).reduce((s, e) => s + parseFloat(e.amount), 0);
      const receivable = entries.rows.filter((e) => e.serving_outlet_id === b.id).reduce((s, e) => s + parseFloat(e.amount), 0);
      if (payable === 0 && receivable === 0) continue;
      const netCash = receivable - payable; // >0 branch receives, <0 branch pays
      const lines: JournalLineInput[] = [];
      if (payable > 0) lines.push({ accountCode: ACC.INTERBRANCH_PAYABLE, debit: payable, memo: 'Clear inter-branch payable' });
      if (receivable > 0) lines.push({ accountCode: ACC.INTERBRANCH_RECEIVABLE, credit: receivable, memo: 'Clear inter-branch receivable' });
      if (netCash > 0) lines.push({ accountCode: ACC.CASH, debit: netCash, memo: 'Settlement received' });
      else if (netCash < 0) lines.push({ accountCode: ACC.CASH, credit: -netCash, memo: 'Settlement paid' });
      const res = await this.accounting.postEntry(tenantId, {
        entryDate: date, outletId: b.id, memo: 'Inter-branch settlement payout',
        sourceType: b.sourceType, sourceId: payoutId, lines,
      });
      posted = posted || !res.skipped;
    }
    return posted;
  }

  /**
   * Stock opname reconciliation → book the net inventory variance. A shrinkage
   * (counted < book) writes off inventory: Dr COGS / Cr Inventory; an overage
   * reverses it: Dr Inventory / Cr COGS. Recomputed from the closed count sheet
   * so it's idempotent and `sync()`-backfillable, matching the other posters.
   */
  async postOpname(tenantId: string, opnameId: string): Promise<boolean> {
    const head = await this.pool.query<{ outlet_id: string | null; status: string; closed_at: string | null }>(
      `SELECT outlet_id, status, closed_at FROM stock_opname WHERE id = $1 AND tenant_id = $2`,
      [opnameId, tenantId],
    );
    if (head.rows.length === 0) return false;
    const h = head.rows[0]!;
    if (h.status !== 'closed' || !h.closed_at) return false; // only booked once reconciled
    const varRes = await this.pool.query<{ variance: string }>(
      `SELECT COALESCE(SUM(variance_value), 0) AS variance FROM stock_opname_items WHERE opname_id = $1`,
      [opnameId],
    );
    const variance = parseFloat(varRes.rows[0]!.variance) || 0;
    if (variance === 0) return false; // nothing to book
    const amount = Math.abs(variance);
    const date = new Date(h.closed_at).toISOString().slice(0, 10);
    const lines: JournalLineInput[] =
      variance < 0
        ? [
            { accountCode: ACC.COGS, debit: amount, memo: 'Stock opname shrinkage' },
            { accountCode: ACC.INVENTORY, credit: amount, memo: 'Inventory write-off (opname)' },
          ]
        : [
            { accountCode: ACC.INVENTORY, debit: amount, memo: 'Inventory overage (opname)' },
            { accountCode: ACC.COGS, credit: amount, memo: 'Stock opname overage' },
          ];
    const res = await this.accounting.postEntry(tenantId, {
      entryDate: date, outletId: h.outlet_id, memo: 'Stock opname reconciliation', sourceType: 'opname', sourceId: opnameId, lines,
    });
    return !res.skipped;
  }

  /**
   * Backfill: post any not-yet-booked orders/expenses/payroll/settlement/opname in
   * a date range. Idempotent (postEntry dedupes by source); per-item errors (e.g. a
   * closed period) are skipped so one bad row can't abort the whole sync.
   */
  async sync(tenantId: string, from: string, to: string): Promise<{ orders: number; expenses: number; payroll: number; settlementAccruals: number; settlementPayouts: number; opnames: number }> {
    const counts = { orders: 0, expenses: 0, payroll: 0, settlementAccruals: 0, settlementPayouts: 0, opnames: 0 };
    const run = async (fn: () => Promise<boolean>, key: keyof typeof counts) => {
      try { if (await fn()) counts[key]++; } catch (e) { this.logger.warn(`sync skip: ${e instanceof Error ? e.message : e}`); }
    };

    const orders = await this.pool.query<{ id: string }>(
      `SELECT id FROM orders WHERE tenant_id = $1 AND status IN ('paid','confirmed','completed')
         AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );
    for (const o of orders.rows) await run(() => this.postOrder(tenantId, o.id), 'orders');

    const expenses = await this.pool.query<{ id: string }>(
      `SELECT id FROM expenses WHERE tenant_id = $1 AND expense_date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );
    for (const e of expenses.rows) await run(() => this.postExpense(tenantId, e.id), 'expenses');

    const runs = await this.pool.query<{ id: string }>(
      `SELECT id FROM payroll_runs WHERE tenant_id = $1 AND status = 'finalized'
         AND (period || '-01')::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );
    for (const r of runs.rows) await run(() => this.postPayrollRun(tenantId, r.id), 'payroll');

    const accruals = await this.pool.query<{ id: string }>(
      `SELECT id FROM settlement_entries WHERE tenant_id = $1 AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );
    for (const a of accruals.rows) await run(() => this.postSettlementAccrual(tenantId, a.id), 'settlementAccruals');

    const payouts = await this.pool.query<{ id: string }>(
      `SELECT id FROM settlement_payouts WHERE tenant_id = $1 AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );
    for (const po of payouts.rows) await run(() => this.postSettlementPayout(tenantId, po.id), 'settlementPayouts');

    const opnames = await this.pool.query<{ id: string }>(
      `SELECT id FROM stock_opname WHERE tenant_id = $1 AND status = 'closed'
         AND closed_at::date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to],
    );
    for (const op of opnames.rows) await run(() => this.postOpname(tenantId, op.id), 'opnames');

    return counts;
  }
}
