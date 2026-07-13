import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { seedDefaultChartOfAccounts, ACC } from './chart-of-accounts.defaults';

export interface JournalLineInput { accountId?: string; accountCode?: string; debit?: number; credit?: number; memo?: string }
export interface PostEntryInput {
  entryDate?: string;
  outletId?: string | null;
  memo?: string;
  sourceType?: string;
  sourceId?: string | null;
  lines: JournalLineInput[];
  createdBy?: string;
  /** Internal: skip the closed-period guard (used by system closing entries). */
  bypassPeriodLock?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * AccountingService — the double-entry general ledger. Owns the chart of
 * accounts, posts balanced journal entries (idempotent per source row), and
 * derives trial balance / general ledger / account balances from journal_lines.
 * Money events are turned into entries by AccountingPoster; this service holds
 * the primitive `postEntry` both the poster and the manual API use.
 */
@Injectable()
export class AccountingService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ─── Chart of accounts ──────────────────────────────────────────────────
  async listAccounts(tenantId: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT id, code, name, type, normal_balance, is_system, is_active
       FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id, code: r.code, name: r.name, type: r.type,
      normalBalance: r.normal_balance, isSystem: r.is_system, isActive: r.is_active,
    }));
  }

  async seedDefaults(tenantId: string): Promise<{ seeded: number }> {
    return { seeded: await seedDefaultChartOfAccounts(this.pool, tenantId) };
  }

  // ─── Accounting periods (open/close) ────────────────────────────────────
  /** Explicitly-recorded period statuses. Periods with no row are OPEN. */
  async listPeriods(tenantId: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT period, status, closed_at FROM accounting_periods WHERE tenant_id = $1 ORDER BY period DESC`,
      [tenantId],
    );
    return res.rows.map((r) => ({ period: r.period, status: r.status, closedAt: r.closed_at }));
  }

  async setPeriod(tenantId: string, period: string, status: 'open' | 'closed', userId?: string): Promise<{ period: string; status: string; netProfit?: number }> {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequestException('period must be YYYY-MM');
    if (!['open', 'closed'].includes(status)) throw new BadRequestException('status must be open or closed');

    let netProfit: number | undefined;
    if (status === 'closed') {
      // Post the closing entry FIRST (period still open so postEntry accepts it),
      // rolling the period's revenue/expense into Retained Earnings.
      await this.deleteClosingEntry(tenantId, period);
      netProfit = await this.postClosingEntry(tenantId, period, userId);
    }

    const closedAt = status === 'closed' ? new Date().toISOString() : null;
    const closedBy = status === 'closed' ? (userId ?? null) : null;
    await this.pool.query(
      `INSERT INTO accounting_periods (tenant_id, period, status, closed_at, closed_by)
       VALUES ($1,$2,$3,$4::timestamptz,$5::uuid)
       ON CONFLICT (tenant_id, period) DO UPDATE
         SET status = EXCLUDED.status, closed_at = EXCLUDED.closed_at, closed_by = EXCLUDED.closed_by`,
      [tenantId, period, status, closedAt, closedBy],
    );

    // Reopening removes the closing entry so the period is live again.
    if (status === 'open') await this.deleteClosingEntry(tenantId, period);
    return { period, status, netProfit };
  }

  /** Remove a period's closing entry (on reopen or before re-closing). */
  private async deleteClosingEntry(tenantId: string, period: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM journal_entries
       WHERE tenant_id = $1 AND source_type = 'period_close' AND to_char(entry_date, 'YYYY-MM') = $2`,
      [tenantId, period],
    );
  }

  /**
   * Post the period-close entry: zero out the period's revenue & expense accounts
   * (operational activity only — excludes prior closing entries) into Retained
   * Earnings, dated the last day of the period. Returns the period net profit.
   */
  private async postClosingEntry(tenantId: string, period: string, userId?: string): Promise<number> {
    const codeMap = await this.accountIdMap(this.pool, tenantId);
    const res = await this.pool.query<{ id: string; type: string; d: string; c: string }>(
      `SELECT a.id, a.type, COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
       FROM chart_of_accounts a
       JOIN journal_lines jl ON jl.account_id = a.id
       JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
         AND je.source_type <> 'period_close' AND to_char(je.entry_date, 'YYYY-MM') = $2
       WHERE a.tenant_id = $1 AND a.type IN ('revenue','expense')
       GROUP BY a.id, a.type`,
      [tenantId, period],
    );
    const lines: JournalLineInput[] = [];
    let totalRev = 0, totalExp = 0;
    for (const r of res.rows) {
      const d = parseFloat(r.d), c = parseFloat(r.c);
      if (r.type === 'revenue') {
        const net = round2(c - d); // credit-normal balance
        totalRev += net;
        if (net > 0) lines.push({ accountId: r.id, debit: net, memo: 'Close revenue' });
        else if (net < 0) lines.push({ accountId: r.id, credit: -net, memo: 'Close revenue' });
      } else {
        const net = round2(d - c); // debit-normal balance
        totalExp += net;
        if (net > 0) lines.push({ accountId: r.id, credit: net, memo: 'Close expense' });
        else if (net < 0) lines.push({ accountId: r.id, debit: -net, memo: 'Close expense' });
      }
    }
    const netProfit = round2(totalRev - totalExp);
    if (lines.length === 0) return 0; // nothing to close
    // Retained Earnings takes the net: credit on profit, debit on loss.
    const retainedId = codeMap.get(ACC.RETAINED_EARNINGS);
    if (netProfit > 0) lines.push({ accountId: retainedId, credit: netProfit, memo: `Net profit ${period}` });
    else if (netProfit < 0) lines.push({ accountId: retainedId, debit: -netProfit, memo: `Net loss ${period}` });
    // If netProfit === 0 the rev/exp lines already balance each other.
    const lastDay = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0);
    const entryDate = `${period}-${String(lastDay.getDate()).padStart(2, '0')}`;
    await this.postEntry(tenantId, { entryDate, memo: `Closing entry ${period}`, sourceType: 'period_close', sourceId: null, lines, createdBy: userId, bypassPeriodLock: true });
    return netProfit;
  }

  /** True when the month containing `dateStr` (YYYY-MM-DD) is explicitly closed. */
  private async isPeriodClosed(client: PoolClient | Pool, tenantId: string, dateStr: string): Promise<boolean> {
    const period = dateStr.slice(0, 7);
    const res = await client.query<{ status: string }>(
      `SELECT status FROM accounting_periods WHERE tenant_id = $1 AND period = $2`,
      [tenantId, period],
    );
    return res.rows[0]?.status === 'closed';
  }

  async createAccount(tenantId: string, dto: { code: string; name: string; type: string; normalBalance?: string }): Promise<Record<string, unknown>> {
    const types = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    if (!dto.code?.trim() || !dto.name?.trim()) throw new BadRequestException('code and name are required');
    if (!types.includes(dto.type)) throw new BadRequestException('invalid account type');
    // Default the normal balance from the type when not given.
    const normal = dto.normalBalance ?? (['asset', 'expense'].includes(dto.type) ? 'debit' : 'credit');
    try {
      const res = await this.pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, type, normal_balance`,
        [tenantId, dto.code.trim(), dto.name.trim(), dto.type, normal],
      );
      const r = res.rows[0]!;
      return { id: r.id, code: r.code, name: r.name, type: r.type, normalBalance: r.normal_balance };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new BadRequestException(`Account code ${dto.code} already exists`);
      throw e;
    }
  }

  /** Resolve a code→id map for this tenant (seeding defaults first if the COA is empty). */
  private async accountIdMap(client: PoolClient | Pool, tenantId: string): Promise<Map<string, string>> {
    let res = await client.query<{ id: string; code: string }>(`SELECT id, code FROM chart_of_accounts WHERE tenant_id = $1`, [tenantId]);
    if (res.rows.length === 0) {
      await seedDefaultChartOfAccounts(this.pool, tenantId);
      res = await client.query<{ id: string; code: string }>(`SELECT id, code FROM chart_of_accounts WHERE tenant_id = $1`, [tenantId]);
    }
    return new Map(res.rows.map((r) => [r.code, r.id]));
  }

  // ─── Posting ────────────────────────────────────────────────────────────
  /**
   * Post one balanced journal entry. Debits must equal credits. Idempotent when
   * (sourceType, sourceId) is supplied — a duplicate returns the existing entry
   * id instead of erroring, so auto-posting / sync can safely re-run.
   * Returns { id, skipped } where skipped=true means it was already posted.
   */
  async postEntry(tenantId: string, input: PostEntryInput): Promise<{ id: string; skipped: boolean }> {
    const lines = input.lines ?? [];
    if (lines.length < 2) throw new BadRequestException('A journal entry needs at least two lines');
    const totalDebit = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    if (totalDebit <= 0) throw new BadRequestException('Entry total must be positive');
    if (totalDebit !== totalCredit) throw new BadRequestException(`Unbalanced entry: debit ${totalDebit} ≠ credit ${totalCredit}`);

    // Reject postings into a closed period (both manual and auto-posting).
    const effectiveDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    if (!input.bypassPeriodLock && await this.isPeriodClosed(this.pool, tenantId, effectiveDate)) {
      throw new BadRequestException(`Accounting period ${effectiveDate.slice(0, 7)} is closed`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const codeMap = await this.accountIdMap(client, tenantId);
      // Resolve account ids from codes where needed.
      const resolved = lines.map((l) => {
        const accountId = l.accountId ?? (l.accountCode ? codeMap.get(l.accountCode) : undefined);
        if (!accountId) throw new BadRequestException(`Unknown account ${l.accountCode ?? l.accountId}`);
        return { ...l, accountId };
      });

      const sourceType = input.sourceType ?? 'manual';
      const sourceId = input.sourceId ?? null;
      // Idempotency: if this source is already posted, return it.
      if (sourceId) {
        const dup = await client.query<{ id: string }>(
          `SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3`,
          [tenantId, sourceType, sourceId],
        );
        if (dup.rows.length > 0) { await client.query('ROLLBACK'); return { id: dup.rows[0]!.id, skipped: true }; }
      }

      const entryRes = await client.query<{ id: string }>(
        `INSERT INTO journal_entries (tenant_id, outlet_id, entry_date, memo, source_type, source_id, created_by)
         VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7) RETURNING id`,
        [tenantId, input.outletId ?? null, input.entryDate ?? null, input.memo ?? null, sourceType, sourceId, input.createdBy ?? null],
      );
      const entryId = entryRes.rows[0]!.id;
      for (const l of resolved) {
        await client.query(
          `INSERT INTO journal_lines (tenant_id, entry_id, account_id, debit, credit, memo)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, entryId, l.accountId, round2(l.debit ?? 0), round2(l.credit ?? 0), l.memo ?? null],
        );
      }
      await client.query('COMMIT');
      return { id: entryId, skipped: false };
    } catch (e) {
      await client.query('ROLLBACK');
      // A concurrent insert can race the idempotency check → unique violation; treat as skipped.
      if ((e as { code?: string }).code === '23505') return { id: '', skipped: true };
      throw e;
    } finally {
      client.release();
    }
  }

  /** Manual entry from the UI (accountId-based lines, always sourceType 'manual'). */
  async createManualEntry(tenantId: string, dto: PostEntryInput): Promise<{ id: string }> {
    const res = await this.postEntry(tenantId, { ...dto, sourceType: 'manual', sourceId: null });
    return { id: res.id };
  }

  async voidEntry(tenantId: string, entryId: string): Promise<{ id: string; status: string }> {
    const res = await this.pool.query(
      `UPDATE journal_entries SET status = 'void' WHERE id = $1 AND tenant_id = $2 AND status = 'posted' RETURNING id`,
      [entryId, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Posted entry not found');
    return { id: entryId, status: 'void' };
  }

  // ─── Reports ────────────────────────────────────────────────────────────
  private dateScope(params: unknown[], from?: string, to?: string, outletId?: string): string {
    let clause = '';
    if (from) { params.push(from); clause += ` AND je.entry_date >= $${params.length}::date`; }
    if (to) { params.push(to); clause += ` AND je.entry_date <= $${params.length}::date`; }
    if (outletId) { params.push(outletId); clause += ` AND je.outlet_id = $${params.length}`; }
    return clause;
  }

  /** Trial balance: per-account debit/credit totals + signed balance for a period. */
  async trialBalance(tenantId: string, from?: string, to?: string, outletId?: string): Promise<Record<string, unknown>> {
    const params: unknown[] = [tenantId];
    const scope = this.dateScope(params, from, to, outletId);
    const res = await this.pool.query(
      `SELECT a.id, a.code, a.name, a.type, a.normal_balance,
              COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'${scope}
       WHERE a.tenant_id = $1
       GROUP BY a.id, a.code, a.name, a.type, a.normal_balance
       ORDER BY a.code`,
      params,
    );
    const accounts = res.rows.map((r) => {
      const debit = parseFloat(r.debit), credit = parseFloat(r.credit);
      const balance = r.normal_balance === 'debit' ? debit - credit : credit - debit;
      return { id: r.id, code: r.code, name: r.name, type: r.type, normalBalance: r.normal_balance, debit, credit, balance };
    });
    const totalDebit = round2(accounts.reduce((s, a) => s + a.debit, 0));
    const totalCredit = round2(accounts.reduce((s, a) => s + a.credit, 0));
    const sumByType = (t: string) => round2(accounts.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0));

    // P&L reflects operational activity only — exclude period-close entries so a
    // closed month still shows the revenue/expense it earned (the balance sheet,
    // computed from full balances above, carries the profit into Retained Earnings).
    const p2: unknown[] = [tenantId];
    const scope2 = this.dateScope(p2, from, to, outletId);
    const pnlRes = await this.pool.query(
      `SELECT a.type, COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
       FROM chart_of_accounts a
       JOIN journal_lines jl ON jl.account_id = a.id
       JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted' AND je.source_type <> 'period_close'${scope2}
       WHERE a.tenant_id = $1 AND a.type IN ('revenue','expense')
       GROUP BY a.type`,
      p2,
    );
    let revenue = 0, expense = 0;
    for (const r of pnlRes.rows) {
      const d = parseFloat(r.debit), c = parseFloat(r.credit);
      if (r.type === 'revenue') revenue = round2(c - d); else expense = round2(d - c);
    }
    return {
      accounts,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
      pnl: { revenue, expense, netProfit: round2(revenue - expense) },
      balanceSheet: { assets: sumByType('asset'), liabilities: sumByType('liability'), equity: sumByType('equity') },
    };
  }

  /** General ledger for one account: lines with a running balance. */
  async generalLedger(tenantId: string, accountId: string, from?: string, to?: string, outletId?: string): Promise<Record<string, unknown>> {
    const acc = await this.pool.query<{ code: string; name: string; type: string; normal_balance: string }>(
      `SELECT code, name, type, normal_balance FROM chart_of_accounts WHERE id = $1 AND tenant_id = $2`,
      [accountId, tenantId],
    );
    if (acc.rows.length === 0) throw new NotFoundException('Account not found');
    const params: unknown[] = [tenantId, accountId];
    const scope = this.dateScope(params, from, to, outletId);
    const res = await this.pool.query(
      `SELECT je.entry_date, je.memo AS entry_memo, je.source_type, jl.debit, jl.credit, jl.memo, je.id AS entry_id
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'${scope}
       WHERE jl.tenant_id = $1 AND jl.account_id = $2
       ORDER BY je.entry_date ASC, je.created_at ASC`,
      params,
    );
    const dir = acc.rows[0]!.normal_balance === 'debit' ? 1 : -1;
    let running = 0;
    const lines = res.rows.map((r) => {
      const debit = parseFloat(r.debit), credit = parseFloat(r.credit);
      running = round2(running + dir * (debit - credit));
      return { entryId: r.entry_id, date: r.entry_date, memo: r.memo ?? r.entry_memo, sourceType: r.source_type, debit, credit, balance: running };
    });
    return { account: { id: accountId, ...acc.rows[0] }, lines, closingBalance: running };
  }

  /** Journal: recent entries with their lines (account code/name resolved). */
  async listJournal(tenantId: string, opts: { from?: string; to?: string; outletId?: string; sourceType?: string; limit?: number } = {}): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [tenantId];
    let where = 'je.tenant_id = $1';
    if (opts.from) { params.push(opts.from); where += ` AND je.entry_date >= $${params.length}::date`; }
    if (opts.to) { params.push(opts.to); where += ` AND je.entry_date <= $${params.length}::date`; }
    if (opts.outletId) { params.push(opts.outletId); where += ` AND je.outlet_id = $${params.length}`; }
    if (opts.sourceType) { params.push(opts.sourceType); where += ` AND je.source_type = $${params.length}`; }
    params.push(Math.min(opts.limit ?? 100, 500));
    const entries = await this.pool.query(
      `SELECT je.id, je.entry_date, je.memo, je.source_type, je.source_id, je.status, je.outlet_id, o.name AS outlet_name
       FROM journal_entries je LEFT JOIN outlets o ON o.id = je.outlet_id
       WHERE ${where} ORDER BY je.entry_date DESC, je.created_at DESC LIMIT $${params.length}`,
      params,
    );
    if (entries.rows.length === 0) return [];
    const ids = entries.rows.map((r) => r.id);
    const linesRes = await this.pool.query(
      `SELECT jl.entry_id, jl.debit, jl.credit, jl.memo, a.code, a.name
       FROM journal_lines jl JOIN chart_of_accounts a ON a.id = jl.account_id
       WHERE jl.entry_id = ANY($1::uuid[]) ORDER BY jl.debit DESC`,
      [ids],
    );
    const linesByEntry = new Map<string, Record<string, unknown>[]>();
    for (const l of linesRes.rows) {
      const arr = linesByEntry.get(l.entry_id) ?? [];
      arr.push({ accountCode: l.code, accountName: l.name, debit: parseFloat(l.debit), credit: parseFloat(l.credit), memo: l.memo });
      linesByEntry.set(l.entry_id, arr);
    }
    return entries.rows.map((r) => ({
      id: r.id, date: r.entry_date, memo: r.memo, sourceType: r.source_type, sourceId: r.source_id,
      status: r.status, outletId: r.outlet_id, outletName: r.outlet_name ?? null,
      lines: linesByEntry.get(r.id) ?? [],
    }));
  }
}
