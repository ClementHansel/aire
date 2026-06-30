import { Injectable, Inject, Optional, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface RecordExpenseDto {
  category: string;
  amount: number;
  description?: string;
  expenseDate?: string;
  paymentMethod?: string;
  outletId?: string;
}

/**
 * FinanceService — expense tracking + profit/loss summary (revenue derived from
 * paid orders). Self-reliant; emits events.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async listExpenses(tenantId: string, limit = 50): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, category, description, amount, expense_date, payment_method
       FROM expenses WHERE tenant_id = $1 ORDER BY expense_date DESC, created_at DESC LIMIT $2`,
      [tenantId, Math.min(limit, 200)],
    );
    return res.rows.map((r) => ({
      id: r.id, category: r.category, description: r.description,
      amount: parseFloat(r.amount), date: r.expense_date, paymentMethod: r.payment_method,
    }));
  }

  async recordExpense(tenantId: string, dto: RecordExpenseDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.category?.trim()) throw new BadRequestException('category is required');
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('amount must be positive');
    const res = await this.pool.query(
      `INSERT INTO expenses (tenant_id, outlet_id, category, description, amount, expense_date, payment_method, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7,$8) RETURNING *`,
      [
        tenantId, dto.outletId ?? null, dto.category.trim(), dto.description ?? null,
        dto.amount, dto.expenseDate ?? null, dto.paymentMethod ?? null, actor ?? null,
      ],
    );
    const e = res.rows[0]!;
    void this.eventBus?.emit({
      type: DomainEventType.ExpenseRecorded,
      tenantId, actor: actor ?? 'system',
      payload: { expenseId: e.id, category: e.category, amount: parseFloat(e.amount) },
    });
    return { id: e.id, category: e.category, amount: parseFloat(e.amount), date: e.expense_date };
  }

  /** Profit/loss summary for a window: revenue (paid orders) - expenses. */
  async summary(tenantId: string, days = 30): Promise<Record<string, unknown>> {
    const interval = `${days} days`;
    const revenue = await this.pool.query<{ revenue: string }>(
      `SELECT COALESCE(SUM(total), 0) AS revenue FROM orders
       WHERE tenant_id = $1 AND status IN ('paid','confirmed','completed')
         AND created_at > NOW() - $2::interval`,
      [tenantId, interval],
    );
    const expensesAgg = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE tenant_id = $1 AND expense_date > CURRENT_DATE - $2::interval`,
      [tenantId, interval],
    );
    const byCategory = await this.pool.query<{ category: string; total: string }>(
      `SELECT category, SUM(amount) AS total FROM expenses
       WHERE tenant_id = $1 AND expense_date > CURRENT_DATE - $2::interval
       GROUP BY category ORDER BY total DESC`,
      [tenantId, interval],
    );
    const rev = parseFloat(revenue.rows[0]!.revenue);
    const exp = parseFloat(expensesAgg.rows[0]!.total);
    return {
      windowDays: days,
      revenue: rev,
      expenses: exp,
      netProfit: rev - exp,
      expensesByCategory: byCategory.rows.map((r) => ({ category: r.category, total: parseFloat(r.total) })),
    };
  }
}
