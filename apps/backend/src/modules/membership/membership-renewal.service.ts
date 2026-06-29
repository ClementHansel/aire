import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { MembershipStatus } from '@aire/shared';
import { Membership, MembershipRow } from './interfaces';
import { MembershipPlanService } from './membership-plan.service';

export interface RenewalResult {
  type: 'extension' | 'new_parallel';
  membership: Membership;
}

@Injectable()
export class MembershipRenewalService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly planService: MembershipPlanService,
  ) {}

  /**
   * Processes a membership renewal/purchase for an existing member.
   * - Same plan → extends end_date from current expiry, retains start_date
   * - Different plan → creates new independent parallel membership
   */
  async renewMembership(
    customerId: string,
    planId: string,
    orderId: string,
    existingMemberships: Membership[],
  ): Promise<RenewalResult> {
    const plan = await this.planService.getPlan(planId);

    // Find an existing ACTIVE membership with the same plan_id
    const samePlanMembership = existingMemberships.find(
      (m) => m.planId === planId && m.status === 'active',
    );

    if (samePlanMembership) {
      // Same plan renewal: extend end_date from current expiry
      const newEndDate = this.addMonths(new Date(samePlanMembership.endDate), plan.durationMonths);

      const result = await this.pool.query<MembershipRow>(
        `UPDATE memberships
         SET end_date = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [newEndDate, samePlanMembership.id],
      );

      return {
        type: 'extension',
        membership: this.mapRowToEntity(result.rows[0]!),
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

    return {
      type: 'new_parallel',
      membership: this.mapRowToEntity(result.rows[0]!),
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
