import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { MembershipLifecycleService } from './membership-lifecycle.service';

export interface MembershipListRow {
  id: string;
  customerName: string;
  customerPhone: string;
  planName: string;
  status: string;        // raw DB status
  displayStatus: 'active' | 'grace' | 'revoked' | 'suspended' | 'expired' | 'pending' | 'cancelled';
  startDate: string;
  endDate: string;
  usesCount: number;
  maxUses: number;
  suspendedReason: string | null;
  membershipNumber: string | null;
}

/**
 * Membership management for the CRM (list + manual suspend/reactivate).
 *
 * Status model:
 *  - suspended  → manually blocked by a higher-level role (rule breach); still
 *                 within the paid period but cannot be used until reactivated.
 *  - grace      → paid period ended, within H+1..H+14 (renewable, no benefits).
 *  - revoked    → past H+14; terminal, a new membership is required.
 *  - active     → within the paid period and not suspended.
 * grace/revoked are derived live from end_date here so the CRM is correct even
 * between transition-job runs (see MembershipLifecycleService).
 */
@Injectable()
export class MembershipAdminService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly lifecycle: MembershipLifecycleService,
  ) {}

  async list(tenantId: string, statusFilter?: string): Promise<MembershipListRow[]> {
    const res = await this.pool.query(
      `SELECT m.id, c.name AS customer_name, c.phone AS customer_phone, c.membership_number, mp.name AS plan_name,
              m.status, m.start_date::text AS start_date, m.end_date::text AS end_date,
              m.uses_count, m.max_uses, m.suspended_reason,
              CASE
                WHEN m.status IN ('suspended','cancelled','pending') THEN m.status
                WHEN m.end_date < CURRENT_DATE
                     AND m.end_date + INTERVAL '14 days' >= CURRENT_DATE THEN 'grace'
                WHEN m.end_date + INTERVAL '14 days' < CURRENT_DATE THEN 'revoked'
                ELSE 'active'
              END AS display_status
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.tenant_id = $1
       ORDER BY m.created_at DESC LIMIT 500`,
      [tenantId],
    );
    const rows = res.rows.map((r: any) => ({
      id: r.id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      planName: r.plan_name,
      status: r.status,
      displayStatus: r.display_status,
      startDate: r.start_date,
      endDate: r.end_date,
      usesCount: r.uses_count,
      maxUses: r.max_uses,
      suspendedReason: r.suspended_reason,
      membershipNumber: r.membership_number ?? null,
    }));
    return statusFilter && statusFilter !== 'all'
      ? rows.filter((r) => r.displayStatus === statusFilter)
      : rows;
  }

  /** Manually suspend an ACTIVE membership (rule breach). */
  async suspend(tenantId: string, id: string, reason?: string, actorId?: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE memberships SET status = 'suspended', suspended_at = NOW(), suspended_reason = $3
       WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [id, tenantId, reason ?? null],
    );
    if (res.rowCount === 0) {
      const exists = await this.pool.query(`SELECT status FROM memberships WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      if (exists.rows.length === 0) throw new NotFoundException('Membership not found');
      throw new BadRequestException(`Only active memberships can be suspended (current: ${exists.rows[0].status})`);
    }
    await this.lifecycle.recordEvent(this.pool, tenantId, id, 'suspended', reason ? { reason } : null, actorId ?? null);
  }

  /** Reactivate a suspended membership. */
  async reactivate(tenantId: string, id: string, actorId?: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE memberships SET status = 'active', suspended_at = NULL, suspended_reason = NULL
       WHERE id = $1 AND tenant_id = $2 AND status = 'suspended'`,
      [id, tenantId],
    );
    if (res.rowCount === 0) {
      const exists = await this.pool.query(`SELECT status FROM memberships WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      if (exists.rows.length === 0) throw new NotFoundException('Membership not found');
      throw new BadRequestException(`Only suspended memberships can be reactivated (current: ${exists.rows[0].status})`);
    }
    await this.lifecycle.recordEvent(this.pool, tenantId, id, 'reactivated', null, actorId ?? null);
  }

  /** Event history for the CRM membership detail view. */
  async history(tenantId: string, id: string) {
    return this.lifecycle.history(tenantId, id);
  }
}
