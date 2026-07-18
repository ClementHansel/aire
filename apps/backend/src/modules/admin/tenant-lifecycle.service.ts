import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { AuthService } from '../auth/auth.service';
import { EventBusService, DomainEventType } from '../events';
import { TenantRecord } from './admin.service';

export type TenantStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';
export type StatusChangeSource = 'admin' | 'billing' | 'system';

export interface TenantStatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  source: StatusChangeSource;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
}

interface TenantRow {
  id: string; name: string; slug: string; plan: string; status: TenantStatus;
  settings: Record<string, unknown>; created_at: string; updated_at: string;
}

const EVENT_BY_STATUS: Record<TenantStatus, DomainEventType> = {
  active: DomainEventType.TenantReactivated,
  past_due: DomainEventType.TenantPastDue,
  suspended: DomainEventType.TenantSuspended,
  cancelled: DomainEventType.TenantCancelled,
};

/**
 * The single writer of `tenants.status`. Every transition goes through here so
 * it is (a) recorded in tenant_status_events for truthful analytics, (b) broadcast
 * as a domain event, and (c) reflected immediately by invalidating the auth-layer
 * status cache. Admin actions, the billing dunning job, and system automation all
 * funnel through changeStatus — there is no other path that mutates status.
 */
@Injectable()
export class TenantLifecycleService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
    private readonly events: EventBusService,
  ) {}

  /**
   * Move a tenant to `to`. Idempotent: re-requesting the current status is a no-op
   * (returns the tenant unchanged, records nothing) so the dunning job can call it
   * repeatedly. Writes the history row + emits the matching domain event.
   */
  async changeStatus(
    tenantId: string,
    to: TenantStatus,
    opts: { reason?: string | null; actorUserId?: string | null; source?: StatusChangeSource } = {},
  ): Promise<TenantRecord> {
    const source = opts.source ?? 'admin';
    const cur = await this.pool.query<{ status: TenantStatus }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
    if (cur.rows.length === 0) throw new NotFoundException('Tenant not found');
    const from = cur.rows[0]!.status;

    const updated = await this.pool.query<TenantRow>(
      `UPDATE tenants
          SET status = $1, status_reason = $2, status_changed_at = NOW(), updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      [to, opts.reason ?? null, tenantId],
    );
    const row = updated.rows[0]!;

    if (from !== to) {
      await this.pool.query(
        `INSERT INTO tenant_status_events (tenant_id, from_status, to_status, reason, source, actor_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, from, to, opts.reason ?? null, source, opts.actorUserId ?? null],
      );
      this.auth.invalidateTenantStatus(tenantId);
      await this.events.emit({
        type: EVENT_BY_STATUS[to],
        tenantId,
        actor: opts.actorUserId ?? source,
        payload: { from, to, reason: opts.reason ?? null, source },
      });
    }

    return {
      id: row.id, name: row.name, slug: row.slug, plan: row.plan, status: row.status,
      settings: row.settings, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  suspend(tenantId: string, opts: { reason?: string; actorUserId?: string; source?: StatusChangeSource } = {}) {
    return this.changeStatus(tenantId, 'suspended', { ...opts, source: opts.source ?? 'admin' });
  }

  /** Restore a suspended/past-due/cancelled tenant to active. */
  reactivate(tenantId: string, opts: { reason?: string; actorUserId?: string; source?: StatusChangeSource } = {}) {
    return this.changeStatus(tenantId, 'active', { ...opts, source: opts.source ?? 'admin' });
  }

  cancel(tenantId: string, opts: { reason?: string; actorUserId?: string; source?: StatusChangeSource } = {}) {
    return this.changeStatus(tenantId, 'cancelled', { ...opts, source: opts.source ?? 'admin' });
  }

  markPastDue(tenantId: string, opts: { reason?: string; source?: StatusChangeSource } = {}) {
    return this.changeStatus(tenantId, 'past_due', { ...opts, source: opts.source ?? 'billing' });
  }

  /** Full status history for a tenant, newest first, with the acting user's name. */
  async history(tenantId: string): Promise<TenantStatusEvent[]> {
    const r = await this.pool.query(
      `SELECT e.id, e.from_status, e.to_status, e.reason, e.source, e.actor_user_id,
              u.name AS actor_name, e.created_at
         FROM tenant_status_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.tenant_id = $1
        ORDER BY e.created_at DESC`,
      [tenantId],
    );
    return r.rows.map((x: any) => ({
      id: x.id, fromStatus: x.from_status, toStatus: x.to_status, reason: x.reason,
      source: x.source, actorUserId: x.actor_user_id, actorName: x.actor_name, createdAt: x.created_at,
    }));
  }

  /** Record a plan change (for MRR analytics). Does not touch status. */
  async recordPlanChange(tenantId: string, from: string | null, to: string, actorUserId?: string | null): Promise<void> {
    if (from === to) return;
    await this.events.emit({
      type: DomainEventType.TenantPlanChanged,
      tenantId,
      actor: actorUserId ?? 'admin',
      payload: { from, to },
    });
  }
}
