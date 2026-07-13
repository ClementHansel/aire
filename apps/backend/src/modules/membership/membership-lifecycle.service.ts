import { Injectable, Inject, Optional, Logger, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { MEMBERSHIP_GRACE_DAYS } from '@aire/shared';

export type MembershipEventType =
  | 'activated' | 'renewed' | 'entered_grace' | 'revoked' | 'expired'
  | 'suspended' | 'reactivated' | 'cancelled' | 'payment' | 'usage';

export interface MembershipEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  actor: string | null;
  createdAt: string;
}

/** Runs the daily transition once every this many ms (single-instance backend). */
const TRANSITION_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h — cheap, converges same-day

/**
 * Owns the membership status lifecycle:
 *  active → grace (H+1..H+14) → revoked (H+15+), with 'suspended' as a separate
 *  manual block. Correctness is enforced two ways: (1) a periodic job that writes
 *  the canonical status and records events, and (2) `derive()` for read paths, so
 *  a stale row never grants benefits even between job runs.
 */
@Injectable()
export class MembershipLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(MembershipLifecycleService.name);
  private running = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  onModuleInit(): void {
    // Fire once at boot, then on a coarse interval. Guarded so overlapping runs
    // are skipped. Kept dependency-free (no @nestjs/schedule).
    void this.runTransitions().catch((e) => this.logger.warn(`initial transition run failed: ${e}`));
    setInterval(() => {
      void this.runTransitions().catch((e) => this.logger.warn(`transition run failed: ${e}`));
    }, TRANSITION_INTERVAL_MS).unref?.();
  }

  /**
   * Canonical status for a membership given its stored status + end date.
   * Manual/terminal states (pending/cancelled/suspended) are returned as-is;
   * everything else is derived from the date so reads are always correct.
   */
  static derive(storedStatus: string, endDate: string | Date, now: Date = new Date()): string {
    if (storedStatus === 'pending' || storedStatus === 'cancelled' || storedStatus === 'suspended') {
      return storedStatus;
    }
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    const graceEnd = new Date(end);
    graceEnd.setDate(graceEnd.getDate() + MEMBERSHIP_GRACE_DAYS);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (today.getTime() <= end.getTime()) return 'active';
    if (today.getTime() <= graceEnd.getTime()) return 'grace';
    return 'revoked';
  }

  /**
   * Advance memberships whose dates warrant a status change and record an event
   * for each transition. Idempotent — only rows that actually change are touched.
   */
  async runTransitions(): Promise<{ toGrace: number; toRevoked: number }> {
    if (this.running) return { toGrace: 0, toRevoked: 0 };
    this.running = true;
    try {
      const grace = await this.pool.query<{ id: string; tenant_id: string; end_date: string }>(
        `UPDATE memberships
            SET status = 'grace',
                grace_until = end_date + INTERVAL '${MEMBERSHIP_GRACE_DAYS} days',
                updated_at = NOW()
          WHERE status = 'active'
            AND end_date < CURRENT_DATE
            AND end_date + INTERVAL '${MEMBERSHIP_GRACE_DAYS} days' >= CURRENT_DATE
          RETURNING id, tenant_id, end_date`,
      );
      for (const r of grace.rows) {
        await this.recordEvent(this.pool, r.tenant_id, r.id, 'entered_grace', null, null);
        // Mirror to the domain EventBus so the AI feed / monitoring see lifecycle
        // transitions, not just the membership_events audit log.
        void this.eventBus?.emit({
          type: DomainEventType.MembershipEnteredGrace,
          tenantId: r.tenant_id, actor: 'system',
          payload: { membershipId: r.id, endDate: r.end_date },
        });
      }

      const revoked = await this.pool.query<{ id: string; tenant_id: string; end_date: string }>(
        `UPDATE memberships
            SET status = 'revoked',
                grace_until = COALESCE(grace_until, end_date + INTERVAL '${MEMBERSHIP_GRACE_DAYS} days'),
                revoked_at = NOW(),
                updated_at = NOW()
          WHERE status IN ('active','grace')
            AND end_date + INTERVAL '${MEMBERSHIP_GRACE_DAYS} days' < CURRENT_DATE
          RETURNING id, tenant_id, end_date`,
      );
      for (const r of revoked.rows) {
        await this.recordEvent(this.pool, r.tenant_id, r.id, 'revoked', null, null);
        void this.eventBus?.emit({
          type: DomainEventType.MembershipRevoked,
          tenantId: r.tenant_id, actor: 'system',
          payload: { membershipId: r.id, endDate: r.end_date },
        });
      }

      if (grace.rowCount || revoked.rowCount) {
        this.logger.log(`membership transitions: ${grace.rowCount} → grace, ${revoked.rowCount} → revoked`);
      }
      return { toGrace: grace.rowCount ?? 0, toRevoked: revoked.rowCount ?? 0 };
    } finally {
      this.running = false;
    }
  }

  /** Append a membership event. Accepts a pool or an in-transaction client. */
  async recordEvent(
    db: Pool | PoolClient,
    tenantId: string,
    membershipId: string,
    eventType: MembershipEventType,
    payload: Record<string, unknown> | null,
    actor: string | null,
  ): Promise<void> {
    await db.query(
      `INSERT INTO membership_events (tenant_id, membership_id, event_type, payload, actor)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, membershipId, eventType, payload ? JSON.stringify(payload) : null, actor],
    );
  }

  /** Event history for a membership (newest first). */
  async history(tenantId: string, membershipId: string): Promise<MembershipEvent[]> {
    const res = await this.pool.query(
      `SELECT id, event_type, payload, actor, created_at
       FROM membership_events
       WHERE tenant_id = $1 AND membership_id = $2
       ORDER BY created_at DESC LIMIT 200`,
      [tenantId, membershipId],
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      eventType: r.event_type,
      payload: r.payload ?? null,
      actor: r.actor ?? null,
      createdAt: r.created_at,
    }));
  }
}
