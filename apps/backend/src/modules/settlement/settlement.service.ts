import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Inter-branch settlement. When a membership wash is redeemed at a branch other
 * than where the membership was sold, the home branch owes the serving branch.
 * Entries are recorded (by the order flow) and settled via payout batches.
 */
@Injectable()
export class SettlementService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Top-level summary: net owed between each branch pair (pending only). */
  async summary(tenantId: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT e.owing_outlet_id, oo.name AS owing_name,
              e.serving_outlet_id, so.name AS serving_name,
              COUNT(*)::int AS entries,
              COALESCE(SUM(e.amount), 0) AS amount
       FROM settlement_entries e
       JOIN outlets oo ON oo.id = e.owing_outlet_id
       JOIN outlets so ON so.id = e.serving_outlet_id
       WHERE e.tenant_id = $1 AND e.status = 'pending'
       GROUP BY e.owing_outlet_id, oo.name, e.serving_outlet_id, so.name
       ORDER BY amount DESC`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      owingOutletId: r.owing_outlet_id, owingName: r.owing_name,
      servingOutletId: r.serving_outlet_id, servingName: r.serving_name,
      entries: r.entries, amount: parseFloat(r.amount),
    }));
  }

  /** Drill-down: individual pending/paid entries, optionally filtered by branch pair. */
  async entries(tenantId: string, owing?: string, serving?: string, status = 'pending'): Promise<Record<string, unknown>[]> {
    const cond = ['e.tenant_id = $1', 'e.status = $2'];
    const v: unknown[] = [tenantId, status];
    if (owing) { cond.push(`e.owing_outlet_id = $${v.length + 1}`); v.push(owing); }
    if (serving) { cond.push(`e.serving_outlet_id = $${v.length + 1}`); v.push(serving); }
    const res = await this.pool.query(
      `SELECT e.id, e.amount, e.status, e.created_at, oo.name AS owing_name, so.name AS serving_name
       FROM settlement_entries e
       JOIN outlets oo ON oo.id = e.owing_outlet_id
       JOIN outlets so ON so.id = e.serving_outlet_id
       WHERE ${cond.join(' AND ')}
       ORDER BY e.created_at DESC LIMIT 500`,
      v,
    );
    return res.rows.map((r) => ({
      id: r.id, amount: parseFloat(r.amount), status: r.status,
      owingName: r.owing_name, servingName: r.serving_name, createdAt: r.created_at,
    }));
  }

  async payouts(tenantId: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT p.id, p.amount, p.entry_count, p.note, p.created_at, oo.name AS owing_name, so.name AS serving_name
       FROM settlement_payouts p
       JOIN outlets oo ON oo.id = p.owing_outlet_id
       JOIN outlets so ON so.id = p.serving_outlet_id
       WHERE p.tenant_id = $1 ORDER BY p.created_at DESC LIMIT 200`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id, amount: parseFloat(r.amount), entryCount: r.entry_count, note: r.note,
      owingName: r.owing_name, servingName: r.serving_name, createdAt: r.created_at,
    }));
  }

  /** Settle all pending entries between a branch pair into one payout batch. */
  async payout(tenantId: string, owingOutletId: string, servingOutletId: string, userId: string, note?: string): Promise<{ payoutId: string; amount: number; count: number }> {
    if (!owingOutletId || !servingOutletId) throw new BadRequestException('owing and serving branch are required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pend = await client.query<{ id: string; amount: string }>(
        `SELECT id, amount FROM settlement_entries
         WHERE tenant_id = $1 AND owing_outlet_id = $2 AND serving_outlet_id = $3 AND status = 'pending'
         FOR UPDATE`,
        [tenantId, owingOutletId, servingOutletId],
      );
      if (pend.rows.length === 0) throw new BadRequestException('No pending entries for this branch pair');
      const total = pend.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
      const payoutRes = await client.query<{ id: string }>(
        `INSERT INTO settlement_payouts (tenant_id, owing_outlet_id, serving_outlet_id, amount, entry_count, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenantId, owingOutletId, servingOutletId, total, pend.rows.length, note ?? null, userId],
      );
      const payoutId = payoutRes.rows[0]!.id;
      await client.query(
        `UPDATE settlement_entries SET status = 'paid', payout_id = $1
         WHERE tenant_id = $2 AND owing_outlet_id = $3 AND serving_outlet_id = $4 AND status = 'pending'`,
        [payoutId, tenantId, owingOutletId, servingOutletId],
      );
      await client.query('COMMIT');
      return { payoutId, amount: total, count: pend.rows.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
