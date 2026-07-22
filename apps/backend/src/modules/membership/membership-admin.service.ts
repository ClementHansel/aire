import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { MembershipLifecycleService } from './membership-lifecycle.service';
import { MembershipPlateService } from './membership-plate.service';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import {
  ERR_MEMBERSHIP_NOT_FOUND,
  ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED,
  ERR_MEMBERSHIP_MIN_ONE_PLATE,
  ERR_MEMBERSHIP_ALREADY_CANCELLED,
  normalizePlate,
} from '@aire/shared';

export interface PlateUpdateInput {
  plate: string;
  brand?: string;
  model?: string;
}

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
    private readonly plateService: MembershipPlateService,
    @Optional() private readonly eventBus?: EventBusService,
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
    void this.eventBus?.emit({
      type: DomainEventType.MembershipSuspended,
      tenantId, actor: actorId ?? null,
      payload: { membershipId: id, reason: reason ?? null },
    });
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
    void this.eventBus?.emit({
      type: DomainEventType.MembershipReactivated,
      tenantId, actor: actorId ?? null,
      payload: { membershipId: id },
    });
  }

  /** Event history for the CRM membership detail view. */
  async history(tenantId: string, id: string) {
    return this.lifecycle.history(tenantId, id);
  }

  /**
   * Full-replace update of a membership's registered plates — the POS's plate
   * management surface (edit/add/remove) submits the desired final list here.
   * Reconciles against the current rows (by normalized plate) and delegates
   * each add/update/remove to MembershipPlateService so every mutation keeps
   * its existing per-plate audit_logs entry. At least one plate must remain
   * (a membership without any registered vehicle can't be used) and the
   * plan's max_plates is enforced.
   */
  async updatePlates(
    tenantId: string,
    membershipId: string,
    plates: PlateUpdateInput[],
    actorId?: string,
  ) {
    const membershipRes = await this.pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM memberships WHERE id = $1 AND tenant_id = $2`,
      [membershipId, tenantId],
    );
    if (membershipRes.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_NOT_FOUND);
    }

    if (!Array.isArray(plates) || plates.length === 0) {
      throw new BadRequestException(ERR_MEMBERSHIP_MIN_ONE_PLATE);
    }

    const planRes = await this.pool.query<{ max_plates: number }>(
      `SELECT max_plates FROM membership_plans WHERE id = $1`,
      [membershipRes.rows[0]!.plan_id],
    );
    const maxPlates = planRes.rows[0]?.max_plates ?? 3;
    if (plates.length > maxPlates) {
      throw new BadRequestException(ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED);
    }

    // Dedupe incoming rows by normalized plate — last occurrence wins.
    const incoming = new Map<string, PlateUpdateInput>();
    for (const p of plates) {
      const { normalized } = normalizePlate(p.plate);
      if (normalized) incoming.set(normalized, p);
    }
    if (incoming.size === 0) {
      throw new BadRequestException(ERR_MEMBERSHIP_MIN_ONE_PLATE);
    }

    const existing = await this.plateService.getPlates(membershipId);
    const existingByKey = new Map(existing.map((e) => [e.plateNormalized, e]));

    // Removals first so additions never trip the max_plates check.
    for (const e of existing) {
      if (!incoming.has(e.plateNormalized)) {
        await this.plateService.removePlate(e.id, actorId);
      }
    }
    for (const [key, p] of incoming) {
      const match = existingByKey.get(key);
      if (match) {
        if (match.plate !== p.plate || (match.brand ?? null) !== (p.brand ?? null) || (match.model ?? null) !== (p.model ?? null)) {
          await this.plateService.updatePlate(match.id, p.plate, p.brand, p.model, actorId);
        }
      } else {
        await this.plateService.addPlate(membershipId, p.plate, p.brand, p.model, actorId);
      }
    }

    return this.plateService.getPlates(membershipId);
  }

  /**
   * Cancel a membership (POS/CRM "cancel membership" action). Terminal —
   * releases all registered plates and is audit-logged with the operator and
   * before/after status. Idempotency guard: an already-cancelled membership
   * cannot be cancelled again.
   */
  async cancel(tenantId: string, id: string, reason?: string, actorId?: string): Promise<void> {
    const res = await this.pool.query<{ status: string }>(
      `SELECT status FROM memberships WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException(ERR_MEMBERSHIP_NOT_FOUND);

    const previousStatus = res.rows[0]!.status;
    if (previousStatus === 'cancelled') {
      throw new BadRequestException(ERR_MEMBERSHIP_ALREADY_CANCELLED);
    }

    await this.pool.query(
      `UPDATE memberships SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    // Release plates so they're free for a future membership; this call is
    // itself audit-logged ('plates_released') by MembershipPlateService.
    await this.plateService.releasePlates(id);

    await this.lifecycle.recordEvent(this.pool, tenantId, id, 'cancelled', reason ? { reason } : null, actorId ?? null);

    await this.pool.query(
      `INSERT INTO audit_logs (tenant_id, user_id, operation, entity_type, entity_id, before_value, after_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        actorId ?? null,
        'membership_cancelled',
        'membership',
        id,
        JSON.stringify({ status: previousStatus }),
        JSON.stringify({ status: 'cancelled', reason: reason ?? null }),
      ],
    );

    void this.eventBus?.emit({
      type: DomainEventType.MembershipCancelled,
      tenantId, actor: actorId ?? null,
      payload: { membershipId: id, reason: reason ?? null },
    });
  }
}
