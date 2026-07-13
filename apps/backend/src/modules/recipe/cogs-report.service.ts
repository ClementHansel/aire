import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

const PAID = `('paid','confirmed','completed')`;

/**
 * COGS-aware financial reporting: real P&L (revenue − COGS − expenses),
 * per-product margin, and inventory actual-vs-forecast (opname variance).
 * COGS comes from the frozen order_items.cost_snapshot (recipe cost at sale time).
 */
@Injectable()
export class CogsReportService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private range(dateFrom?: string, dateTo?: string): { from: string; to: string } {
    // Default: last 30 days (inclusive of today).
    const to = dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : new Date().toISOString().slice(0, 10);
    let from = dateFrom;
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 30);
      from = d.toISOString().slice(0, 10);
    }
    return { from, to };
  }

  async pnl(tenantId: string, dateFrom?: string, dateTo?: string) {
    const { from, to } = this.range(dateFrom, dateTo);
    const revenue = await this.pool.query<{ v: string }>(
      `SELECT COALESCE(SUM(total),0) AS v FROM orders
       WHERE tenant_id = $1 AND status IN ${PAID}
         AND created_at >= $2::date AND created_at < ($3::date + 1)`,
      [tenantId, from, to],
    );
    const cogs = await this.pool.query<{ v: string }>(
      `SELECT COALESCE(SUM(oi.cost_snapshot * oi.quantity),0) AS v
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = $1 AND o.status IN ${PAID}
         AND o.created_at >= $2::date AND o.created_at < ($3::date + 1)`,
      [tenantId, from, to],
    );
    const expenses = await this.pool.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount),0) AS v FROM expenses
       WHERE tenant_id = $1 AND expense_date >= $2::date AND expense_date <= $3::date`,
      [tenantId, from, to],
    );
    const rev = parseFloat(revenue.rows[0]!.v);
    const c = parseFloat(cogs.rows[0]!.v);
    const exp = parseFloat(expenses.rows[0]!.v);
    const gross = rev - c;
    return {
      dateFrom: from, dateTo: to,
      revenue: rev, cogs: c, grossProfit: gross,
      grossMarginPct: rev > 0 ? (gross / rev) * 100 : 0,
      expenses: exp, netProfit: gross - exp,
    };
  }

  async productMargin(tenantId: string, dateFrom?: string, dateTo?: string) {
    const { from, to } = this.range(dateFrom, dateTo);
    const r = await this.pool.query(
      `SELECT s.id, s.name,
              SUM(oi.quantity) AS qty,
              SUM(oi.subtotal) AS revenue,
              SUM(COALESCE(oi.cost_snapshot,0) * oi.quantity) AS cogs
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN services s ON s.id = oi.service_id
       WHERE o.tenant_id = $1 AND o.status IN ${PAID}
         AND o.created_at >= $2::date AND o.created_at < ($3::date + 1)
       GROUP BY s.id, s.name
       ORDER BY revenue DESC LIMIT 100`,
      [tenantId, from, to],
    );
    return {
      dateFrom: from, dateTo: to,
      products: r.rows.map((x: any) => {
        const revenue = parseFloat(x.revenue);
        const cogs = parseFloat(x.cogs);
        return {
          serviceId: x.id, name: x.name, qty: parseFloat(x.qty),
          revenue, cogs, margin: revenue - cogs,
          marginPct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
        };
      }),
    };
  }

  /**
   * Inventory actual-vs-forecast: variance from a closed opname (expected = book/
   * forecast stock, counted = actual physical). Defaults to the latest closed opname.
   */
  async inventoryVariance(tenantId: string, opnameId?: string) {
    let id = opnameId;
    if (!id) {
      const latest = await this.pool.query<{ id: string }>(
        `SELECT id FROM stock_opname WHERE tenant_id = $1 AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
        [tenantId],
      );
      if (latest.rows.length === 0) return { opnameId: null, closedAt: null, items: [], totalVarianceValue: 0 };
      id = latest.rows[0]!.id;
    }
    const head = await this.pool.query<{ closed_at: string }>(
      `SELECT closed_at FROM stock_opname WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const items = await this.pool.query(
      `SELECT ii.name, ii.unit, i.expected_qty, i.counted_qty, i.variance, i.variance_value
       FROM stock_opname_items i JOIN inventory_items ii ON ii.id = i.inventory_item_id
       WHERE i.opname_id = $1 AND i.variance IS NOT NULL
       ORDER BY i.variance_value ASC`,
      [id],
    );
    const rows = items.rows.map((x: any) => ({
      name: x.name, unit: x.unit,
      expectedQty: parseFloat(x.expected_qty),
      countedQty: x.counted_qty == null ? null : parseFloat(x.counted_qty),
      variance: parseFloat(x.variance),
      varianceValue: parseFloat(x.variance_value),
    }));
    return {
      opnameId: id,
      closedAt: head.rows[0]?.closed_at ?? null,
      items: rows,
      totalVarianceValue: rows.reduce((s, r) => s + r.varianceValue, 0),
    };
  }
}
