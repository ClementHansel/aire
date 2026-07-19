import { Injectable, Inject, Optional, Logger, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { NotificationService, NotificationType } from '../notification/notification.service';
import { JobMonitorService } from '../job-monitor';
import { MEMBERSHIP_GRACE_DAYS } from '@aire/shared';

export type MembershipEventType =
  | 'activated' | 'renewed' | 'entered_grace' | 'revoked' | 'expired'
  | 'suspended' | 'reactivated' | 'cancelled' | 'payment' | 'usage' | 'reminder';

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
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly jobMonitor?: JobMonitorService,
  ) {}

  onModuleInit(): void {
    // Fire once at boot, then on a coarse interval. Guarded so overlapping runs
    // are skipped. Kept dependency-free (no @nestjs/schedule).
    void this.sweep();
    setInterval(() => { void this.sweep(); }, TRANSITION_INTERVAL_MS).unref?.();
  }

  /** One maintenance pass: advance statuses first, then send expiry reminders. */
  private async sweep(): Promise<void> {
    const started = Date.now();
    const t = await this.runTransitions().catch((e) => {
      this.logger.warn(`transition run failed: ${e}`);
      return null;
    });
    await this.sendExpiryReminders().catch((e) => this.logger.warn(`expiry reminder run failed: ${e}`));
    void this.jobMonitor?.recordRun('membership-lifecycle', {
      label: 'Membership lifecycle (grace/expiry)',
      status: t ? 'ok' : 'error',
      durationMs: Date.now() - started,
      intervalMs: TRANSITION_INTERVAL_MS,
      detail: t ? `${t.toGrace} → grace, ${t.toRevoked} → revoked` : 'transition run failed',
    });
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

  /**
   * Send WhatsApp expiry reminders at H-30, H-7, and H-day for active memberships.
   * Idempotent: a `reminder` membership_event is recorded per milestone, so the
   * same reminder is never sent twice even across the 6-hourly runs / restarts.
   * Delivery is best-effort via NotificationService (drained in-process).
   */
  async sendExpiryReminders(): Promise<number> {
    if (!this.notifications) return 0;
    const due = await this.pool.query<{
      id: string; tenant_id: string; end_date: string; days_left: number;
      customer_name: string; customer_phone: string; plan_name: string | null;
    }>(
      `SELECT m.id, m.tenant_id, m.end_date::text AS end_date,
              (m.end_date - CURRENT_DATE) AS days_left,
              c.name AS customer_name, c.phone AS customer_phone, mp.name AS plan_name
         FROM memberships m
         JOIN customers c ON c.id = m.customer_id
         LEFT JOIN membership_plans mp ON mp.id = m.plan_id
        WHERE m.status = 'active'
          AND (m.end_date - CURRENT_DATE) IN (30, 7, 0)
          AND c.phone IS NOT NULL AND c.phone <> ''
          AND NOT EXISTS (
            SELECT 1 FROM membership_events e
             WHERE e.membership_id = m.id
               AND e.event_type = 'reminder'
               AND e.payload->>'milestone' = (m.end_date - CURRENT_DATE)::text
          )`,
    );

    let sent = 0;
    for (const r of due.rows) {
      try {
        await this.notifications.queueNotification(NotificationType.ExpiryReminder, {
          phone: r.customer_phone,
          customerName: r.customer_name ?? '',
          planName: r.plan_name ?? '',
          daysRemaining: String(r.days_left),
          endDate: r.end_date,
          tenantId: r.tenant_id,
        });
        // Record after enqueue so the milestone isn't reminded again (delivery is
        // fire-and-forget; a failed send is logged by NotificationService).
        // actor is a uuid column — system-generated events carry null (like the
        // grace/revoked transitions above); the system origin is noted in payload.
        await this.recordEvent(this.pool, r.tenant_id, r.id, 'reminder', { milestone: r.days_left, source: 'system' }, null);
        sent++;
      } catch (e) {
        this.logger.warn(`expiry reminder for membership ${r.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (sent) this.logger.log(`membership expiry reminders sent: ${sent}`);
    return sent;
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
