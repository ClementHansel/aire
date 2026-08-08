import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { JWTPayload, MembershipStatus } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { Membership, MembershipRow } from './interfaces';
import { MembershipPlanService } from './membership-plan.service';
import { MembershipLifecycleService } from './membership-lifecycle.service';
import { PosCheckoutService, resolveServiceBusinessUnit } from '../order/pos-checkout.service';
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
  async renewByMembershipId(user: JWTPayload, membershipId: string, planId: string, nextStartDate?: string) {
    const m = await this.pool.query<{ customer_id: string; end_date: string }>(
      `SELECT customer_id, end_date::text AS end_date FROM memberships WHERE id = $1 AND tenant_id = $2`,
      [membershipId, user.tenant_id],
    );
    if (m.rows.length === 0) throw new NotFoundException('Membership not found');
    const customerId = m.rows[0]!.customer_id;
    // Validate the requested start HERE, while the fee order is still being
    // created: a rejection the cashier can act on beats one that surfaces after
    // the customer has already paid.
    const nextStart = this.validateNextStart(nextStartDate, m.rows[0]!.end_date);

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
      // Same business-unit derivation as a first-time sale: a renewal of a LEAD
      // plan is LEAD revenue. Leaving it to the column default put every renewal
      // in the AIRE bucket and skewed the BU split.
      const businessUnit = await resolveServiceBusinessUnit(client, [
        ...(plan.freeServiceIds ?? []),
        ...plan.discountedServices.map((d) => d.serviceId),
      ]);
      order = await this.checkout.createPackOrder(client, user, {
        customerId,
        customerName: cust.rows[0]?.name ?? 'Member',
        customerPhone: cust.rows[0]?.phone ?? '',
        total: plan.price,
        note: `Renewal: ${plan.name}`,
        businessUnit,
      });
      await client.query(
        `INSERT INTO membership_renewals (tenant_id, order_id, membership_id, plan_id, next_start_date)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id) DO NOTHING`,
        [user.tenant_id, order.id, membershipId, planId, nextStart],
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
    const ren = await this.pool.query<{ id: string; membership_id: string; plan_id: string; applied: boolean; next_start_date: string | null }>(
      `SELECT id, membership_id, plan_id, applied, next_start_date::text AS next_start_date
         FROM membership_renewals WHERE order_id = $1 AND tenant_id = $2`,
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
    const result = await this.renewMembership(
      o.customer_id!, row.plan_id, orderId, existing, row.next_start_date ?? undefined,
    );
    await this.pool.query(`UPDATE membership_renewals SET applied = true, applied_at = NOW() WHERE id = $1`, [row.id]);

    // Tag the fee order: same-plan renewal -> 'renewal'; a different-plan or
    // post-revocation repurchase creates a brand new membership -> 'new_member'
    // (mirrors the CustomerTag semantics in @aire/shared customer-tagging).
    // Idempotent via ON CONFLICT; non-fatal if it fails.
    try {
      const tag = result.type === 'extension' ? 'renewal' : 'new_member';
      await this.pool.query(
        `INSERT INTO order_tags (order_id, tag) VALUES ($1, $2) ON CONFLICT (order_id, tag) DO NOTHING`,
        [orderId, tag],
      );
    } catch { /* tagging is best-effort */ }

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
    nextStartDate?: string,
  ): Promise<RenewalResult> {
    const plan = await this.planService.getPlan(planId);

    // Renewable = same plan AND still active or in the grace window (not revoked).
    const samePlanMembership = existingMemberships.find(
      (m) => m.planId === planId && (m.status === 'active' || m.status === 'grace'),
    );

    if (samePlanMembership) {
      const periodStart = this.renewalPeriodStart(samePlanMembership.endDate, nextStartDate);
      const newEndDate = this.addMonths(periodStart, plan.durationMonths);
      // A renewal taken AFTER the membership lapsed opens a fresh period from the
      // day it is paid for, so start_date has to move with it. Extending only
      // end_date left the member showing a start date from the previous term —
      // "tanggal aktif mengikuti tanggal berakhirnya membership" (AIRIN-156) —
      // and, worse, silently charged them for the days they had already lost. An
      // EARLY renewal keeps its original start: that period is still running.
      const lapsed = periodStart.getTime() > new Date(samePlanMembership.endDate).getTime();

      const result = await this.pool.query<MembershipRow>(
        `UPDATE memberships
         SET end_date = $1,
             start_date = CASE WHEN $3::boolean THEN $4::date ELSE start_date END,
             status = 'active', grace_until = NULL, revoked_at = NULL, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [newEndDate, samePlanMembership.id, lapsed, periodStart],
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

    // Different plan or no existing: create brand new membership. An explicitly
    // requested later start is honoured here too, so a customer who buys today
    // for next week gets the full term they paid for.
    const startDate = nextStartDate ? new Date(`${nextStartDate}T00:00:00`) : new Date();
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

  /** Midnight of the given date, so period arithmetic never drifts by hours. */
  private static atMidnight(d: Date): Date {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  /**
   * Where the renewed period begins.
   *
   * Renewing EARLY stacks onto the current expiry — no days are lost. Renewing
   * LATE (during grace, after the membership already lapsed) starts today: the
   * old rule glued the new period to an expiry that was already in the past, so
   * a member who renewed five days late paid for a month and received twenty-five
   * days (AIRIN-156). An explicit `nextStartDate` overrides both; it has already
   * been bounds-checked by validateNextStart.
   */
  renewalPeriodStart(currentEndDate: string | Date, nextStartDate?: string): Date {
    if (nextStartDate) return MembershipRenewalService.atMidnight(new Date(`${nextStartDate}T00:00:00`));
    const end = MembershipRenewalService.atMidnight(new Date(currentEndDate));
    const today = MembershipRenewalService.atMidnight(new Date());
    return end.getTime() >= today.getTime() ? end : today;
  }

  /**
   * Bound a requested next-period start: never before the current expiry (that
   * would shorten a period the member has already paid for) and never more than
   * 7 days after it (Samuel's rule — beyond a week it is a new membership, not a
   * renewal; AIRIN-157). Returns null when nothing was requested.
   */
  validateNextStart(nextStartDate: string | undefined, currentEndDate: string): string | null {
    if (!nextStartDate) return null;
    const requested = new Date(`${nextStartDate}T00:00:00`);
    if (Number.isNaN(requested.getTime())) {
      throw new BadRequestException('nextStartDate must be a valid date (YYYY-MM-DD).');
    }
    const end = MembershipRenewalService.atMidnight(new Date(currentEndDate));
    const latest = new Date(end.getTime() + 7 * 86_400_000);
    if (requested.getTime() < end.getTime()) {
      throw new BadRequestException('The next period cannot start before the current membership ends.');
    }
    if (requested.getTime() > latest.getTime()) {
      throw new BadRequestException('The next period can start at most 7 days after the membership ends.');
    }
    return nextStartDate;
  }

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
