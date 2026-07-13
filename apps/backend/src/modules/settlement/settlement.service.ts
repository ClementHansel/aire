import { Injectable, Inject, Optional, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

/**
 * Inter-branch settlement. When a membership wash is redeemed at a branch other
 * than where the membership was sold, the home branch owes the serving branch.
 * Entries are recorded (by the order flow) and settled via payout batches.
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Top-level summary: net owed between each branch pair (pending only).
   * Optional branch filter shows only pairs where the branch is involved
   * (as either the owing or the serving side).
   */
  async summary(tenantId: string, outletId?: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT e.owing_outlet_id, oo.name AS owing_name,
              e.serving_outlet_id, so.name AS serving_name,
              COUNT(*)::int AS entries,
              COALESCE(SUM(e.amount), 0) AS amount
       FROM settlement_entries e
       JOIN outlets oo ON oo.id = e.owing_outlet_id
       JOIN outlets so ON so.id = e.serving_outlet_id
       WHERE e.tenant_id = $1 AND e.status = 'pending'
         AND ($2::uuid IS NULL OR e.owing_outlet_id = $2::uuid OR e.serving_outlet_id = $2::uuid)
       GROUP BY e.owing_outlet_id, oo.name, e.serving_outlet_id, so.name
       ORDER BY amount DESC`,
      [tenantId, outletId ?? null],
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

  async payouts(tenantId: string, outletId?: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool.query(
      `SELECT p.id, p.amount, p.entry_count, p.note, p.created_at, oo.name AS owing_name, so.name AS serving_name
       FROM settlement_payouts p
       JOIN outlets oo ON oo.id = p.owing_outlet_id
       JOIN outlets so ON so.id = p.serving_outlet_id
       WHERE p.tenant_id = $1
         AND ($2::uuid IS NULL OR p.owing_outlet_id = $2::uuid OR p.serving_outlet_id = $2::uuid)
       ORDER BY p.created_at DESC LIMIT 200`,
      [tenantId, outletId ?? null],
    );
    return res.rows.map((r) => ({
      id: r.id, amount: parseFloat(r.amount), entryCount: r.entry_count, note: r.note,
      owingName: r.owing_name, servingName: r.serving_name, createdAt: r.created_at,
    }));
  }

  /**
   * Settle pending entries between a branch pair into one payout batch.
   * Pass `entryIds` to settle only a chosen subset (partial settlement); omit it
   * to settle every pending entry for the pair.
   */
  async payout(
    tenantId: string,
    owingOutletId: string,
    servingOutletId: string,
    userId: string,
    note?: string,
    entryIds?: string[],
  ): Promise<{ payoutId: string; amount: number; count: number }> {
    if (!owingOutletId || !servingOutletId) throw new BadRequestException('owing and serving branch are required');
    const subset = entryIds?.filter(Boolean) ?? null;
    if (subset && subset.length === 0) throw new BadRequestException('No entries selected');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the pending entries for this pair, optionally narrowed to a subset.
      const params: unknown[] = [tenantId, owingOutletId, servingOutletId];
      let idClause = '';
      if (subset) { params.push(subset); idClause = ` AND id = ANY($${params.length}::uuid[])`; }
      const pend = await client.query<{ id: string; amount: string }>(
        `SELECT id, amount FROM settlement_entries
         WHERE tenant_id = $1 AND owing_outlet_id = $2 AND serving_outlet_id = $3 AND status = 'pending'${idClause}
         FOR UPDATE`,
        params,
      );
      if (pend.rows.length === 0) throw new BadRequestException('No pending entries for this branch pair');
      if (subset && pend.rows.length !== subset.length) {
        throw new BadRequestException('Some selected entries are no longer pending');
      }
      const total = pend.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
      const ids = pend.rows.map((r) => r.id);
      const payoutRes = await client.query<{ id: string }>(
        `INSERT INTO settlement_payouts (tenant_id, owing_outlet_id, serving_outlet_id, amount, entry_count, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenantId, owingOutletId, servingOutletId, total, pend.rows.length, note ?? null, userId],
      );
      const payoutId = payoutRes.rows[0]!.id;
      await client.query(
        `UPDATE settlement_entries SET status = 'paid', payout_id = $1
         WHERE id = ANY($2::uuid[])`,
        [payoutId, ids],
      );
      await client.query('COMMIT');
      void this.eventBus?.emit({
        type: DomainEventType.SettlementPaidOut,
        tenantId, actor: userId,
        payload: { payoutId, owingOutletId, servingOutletId, amount: total, count: pend.rows.length },
      });
      return { payoutId, amount: total, count: pend.rows.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Net-off two branches that owe each other. Discharges ALL pending entries in
   * both directions (A→B and B→A) at once and records a single payout for the
   * net difference in whichever direction is larger. If the two directions are
   * equal the obligations cancel out (net amount 0) and everything is still
   * marked settled. The offsetting breakdown is written into the payout note.
   */
  async netSettle(
    tenantId: string,
    outletAId: string,
    outletBId: string,
    userId: string,
    note?: string,
  ): Promise<{ payoutId: string; netAmount: number; owingOutletId: string; servingOutletId: string; count: number }> {
    if (!outletAId || !outletBId || outletAId === outletBId) {
      throw new BadRequestException('Two distinct branches are required');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // All pending entries in both directions, locked.
      const pend = await client.query<{ id: string; amount: string; owing_outlet_id: string }>(
        `SELECT id, amount, owing_outlet_id FROM settlement_entries
         WHERE tenant_id = $1 AND status = 'pending'
           AND ((owing_outlet_id = $2 AND serving_outlet_id = $3)
             OR (owing_outlet_id = $3 AND serving_outlet_id = $2))
         FOR UPDATE`,
        [tenantId, outletAId, outletBId],
      );
      if (pend.rows.length === 0) throw new BadRequestException('No pending entries between these branches');

      // Sum each direction. aToB = what A owes B; bToA = what B owes A.
      let aToB = 0, bToA = 0;
      for (const r of pend.rows) {
        const amt = parseFloat(r.amount);
        if (r.owing_outlet_id === outletAId) aToB += amt; else bToA += amt;
      }
      const net = aToB - bToA;
      const owingOutletId = net >= 0 ? outletAId : outletBId;
      const servingOutletId = net >= 0 ? outletBId : outletAId;
      const netAmount = Math.abs(net);
      const breakdown = `Net-off: A→B ${aToB} − B→A ${bToA} = ${net}`;
      const fullNote = note ? `${note} · ${breakdown}` : breakdown;

      const payoutRes = await client.query<{ id: string }>(
        `INSERT INTO settlement_payouts (tenant_id, owing_outlet_id, serving_outlet_id, amount, entry_count, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenantId, owingOutletId, servingOutletId, netAmount, pend.rows.length, fullNote, userId],
      );
      const payoutId = payoutRes.rows[0]!.id;
      await client.query(
        `UPDATE settlement_entries SET status = 'paid', payout_id = $1 WHERE id = ANY($2::uuid[])`,
        [payoutId, pend.rows.map((r) => r.id)],
      );
      await client.query('COMMIT');
      void this.eventBus?.emit({
        type: DomainEventType.SettlementPaidOut,
        tenantId, actor: userId,
        payload: { payoutId, owingOutletId, servingOutletId, amount: netAmount, count: pend.rows.length, netOff: true },
      });
      return { payoutId, netAmount, owingOutletId, servingOutletId, count: pend.rows.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
