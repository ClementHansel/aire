import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { JWTPayload, MembershipStatus } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { Membership, MembershipRow } from './interfaces';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipLifecycleService } from './membership-lifecycle.service';
import { PosCheckoutService } from '../order/pos-checkout.service';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface RenewalResult {
  type: 'extension' | 'new_parallel';
  membership: Membership;
}

@Injectable()
export class MembershipRenewalService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly planService: MembershipPlanService,
    private readonly lifecycle: MembershipLifecycleService,
    private readonly checkout: PosCheckoutService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** All of a customer's memberships (for the extend-vs-new decision). */
  async getCustomerMemberships(tenantId: string, customerId: string): Promise<Membership[]> {
    const r = await this.pool.query<MembershipRow>(
      `SELECT * FROM memberships WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
      [tenantId, customerId],
    );
    return r.rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Orchestrated renewal from a membership id: creates a renewal pack order
   * (the fee) and applies the renewal (extend if active/grace, new if revoked).
   * Returns the unpaid order for the caller to collect payment on.
   */
  async renewByMembershipId(user: JWTPayload, membershipId: string, planId: string) {
    const m = await this.pool.query<{ customer_id: string }>(
      `SELECT customer_id FROM memberships WHERE id = $1 AND tenant_id = $2`,
      [membershipId, user.tenant_id],
    );
    if (m.rows.length === 0) throw new NotFoundException('Membership not found');
    const customerId = m.rows[0]!.customer_id;

    const cust = await this.pool.query<{ name: string; phone: string }>(
      `SELECT name, phone FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, user.tenant_id],
    );
    const plan = await this.planService.getPlan(planId);

    // Create the renewal fee order + a PENDING renewal. The membership is NOT
    // extended here — that happens in applyRenewal() once the order is paid.
    const client = await this.checkout.db.connect();
    let order: { id: string; orderNumber: string; total: number };
    try {
      await client.query('BEGIN');
      order = await this.checkout.createPackOrder(client, user, {
        customerId,
        customerName: cust.rows[0]?.name ?? 'Member',
        customerPhone: cust.rows[0]?.phone ?? '',
        total: plan.price,
        note: `Renewal: ${plan.name}`,
      });
      await client.query(
        `INSERT INTO membership_renewals (tenant_id, order_id, membership_id, plan_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO NOTHING`,
        [user.tenant_id, order.id, membershipId, planId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { order, membershipId };
  }

  /**
   * Apply a pending renewal once its fee order is paid — extends (active/grace)
   * or creates a new membership (revoked). Idempotent; refuses if unpaid.
   */
  async applyRenewal(tenantId: string, orderId: string) {
    const ren = await this.pool.query<{ id: string; membership_id: string; plan_id: string; applied: boolean }>(
      `SELECT id, membership_id, plan_id, applied FROM membership_renewals WHERE order_id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    const row = ren.rows[0];
    if (!row) throw new NotFoundException('No renewal found for this order');
    if (row.applied) return { alreadyApplied: true };

    const ord = await this.pool.query<{ status: string; customer_id: string | null }>(
      `SELECT o.status, m.customer_id
       FROM orders o
       JOIN memberships m ON m.id = $2
       WHERE o.id = $1 AND o.tenant_id = $3`,
      [orderId, row.membership_id, tenantId],
    );
    const o = ord.rows[0];
    if (!o) throw new NotFoundException('Order not found');
    if (!['paid', 'confirmed', 'completed'].includes(o.status)) {
      throw new BadRequestException('Renewal payment is not confirmed yet.');
    }

    const existing = await this.getCustomerMemberships(tenantId, o.customer_id!);
    const result = await this.renewMembership(o.customer_id!, row.plan_id, orderId, existing);
    await this.pool.query(`UPDATE membership_renewals SET applied = true, applied_at = NOW() WHERE id = $1`, [row.id]);
    return { type: result.type, membershipId: result.membership.id };
  }

  /**
   * Processes a membership renewal/purchase for an existing member.
   * - Same plan, still renewable (active or within the grace window) → extend
   *   end_date from current expiry and return the row to active.
   * - Different plan, or a revoked/absent membership → new independent membership
   *   (a revoked membership is past the renewable window, so it cannot be extended).
   */
  async renewMembership(
    customerId: string,
    planId: string,
    orderId: string,
    existingMemberships: Membership[],
  ): Promise<RenewalResult> {
    const plan = await this.planService.getPlan(planId);

    // Renewable = same plan AND still active or in the grace window (not revoked).
    const samePlanMembership = existingMemberships.find(
      (m) => m.planId === planId && (m.status === 'active' || m.status === 'grace'),
    );

    if (samePlanMembership) {
      // Extend end_date from current expiry and clear any grace/revoked markers.
      const newEndDate = this.addMonths(new Date(samePlanMembership.endDate), plan.durationMonths);

      const result = await this.pool.query<MembershipRow>(
        `UPDATE memberships
         SET end_date = $1, status = 'active', grace_until = NULL, revoked_at = NULL, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [newEndDate, samePlanMembership.id],
      );
      const row = result.rows[0]!;
      await this.lifecycle.recordEvent(this.pool, row.tenant_id, row.id, 'renewed', { orderId, planId, type: 'extension' }, null);
      void this.eventBus?.emit({
        type: DomainEventType.MembershipRenewed,
        tenantId: row.tenant_id, actor: 'pos',
        payload: { membershipId: row.id, planId, orderId, type: 'extension' },
      });

      return {
        type: 'extension',
        membership: this.mapRowToEntity(row),
      };
    }

    // Different plan or no existing: create brand new membership
    const startDate = new Date();
    const endDate = this.addMonths(startDate, plan.durationMonths);

    const result = await this.pool.query<MembershipRow>(
      `INSERT INTO memberships
        (tenant_id, customer_id, plan_id, status, start_date, end_date, uses_count, max_uses, daily_limit, order_id)
       VALUES (
         (SELECT tenant_id FROM customers WHERE id = $1),
         $1, $2, 'active', $3, $4, 0, $5, $6, $7
       )
       RETURNING *`,
      [customerId, planId, startDate, endDate, plan.maxUses, plan.dailyLimit, orderId],
    );
    const row = result.rows[0]!;
    await this.lifecycle.recordEvent(this.pool, row.tenant_id, row.id, 'renewed', { orderId, planId, type: 'new_parallel' }, null);
    void this.eventBus?.emit({
      type: DomainEventType.MembershipRenewed,
      tenantId: row.tenant_id, actor: 'pos',
      payload: { membershipId: row.id, planId, orderId, type: 'new_parallel' },
    });

    return {
      type: 'new_parallel',
      membership: this.mapRowToEntity(row),
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Adds the specified number of months to a date.
   * Handles month overflow (e.g., Jan 31 + 1 month = Feb 28/29).
   */
  addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    const targetMonth = result.getMonth() + months;
    result.setMonth(targetMonth);

    // Handle month overflow (e.g., adding 1 month to Jan 31 gives Mar 3 in non-leap years)
    // If the day overflowed, set to last day of the intended target month
    if (result.getMonth() !== targetMonth % 12) {
      result.setDate(0); // sets to last day of previous month
    }

    return result;
  }

  private mapRowToEntity(row: MembershipRow): Membership {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      customerId: row.customer_id,
      planId: row.plan_id,
      status: row.status as MembershipStatus,
      startDate: row.start_date,
      endDate: row.end_date,
      usesCount: row.uses_count,
      maxUses: row.max_uses,
      dailyLimit: row.daily_limit,
      orderId: row.order_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
