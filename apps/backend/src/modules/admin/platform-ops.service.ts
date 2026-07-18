import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { DomainEventType } from '../events';

export type OpsSeverity = 'critical' | 'warning' | 'info';

/**
 * The platform-relevant domain events surfaced in the admin ops feed, each mapped
 * to a severity. These already flow through the EventBus (persisted to
 * domain_events) — the feed just reads them cross-tenant. Add a type here to make
 * it visible to the platform admin.
 */
const SEVERITY_BY_TYPE: Record<string, OpsSeverity> = {
  [DomainEventType.TenantSuspended]: 'critical',
  [DomainEventType.TenantCancelled]: 'critical',
  [DomainEventType.AgentAnomalyFlagged]: 'critical',
  [DomainEventType.DeviceOffline]: 'critical',
  [DomainEventType.TenantPastDue]: 'warning',
  [DomainEventType.TenantLimitReached]: 'warning',
  [DomainEventType.FeedbackAlert]: 'warning',
  [DomainEventType.TenantCreated]: 'info',
  [DomainEventType.TenantReactivated]: 'info',
  [DomainEventType.TenantPlanChanged]: 'info',
  [DomainEventType.SubscriptionInvoicePaid]: 'info',
};

const FEED_TYPES = Object.keys(SEVERITY_BY_TYPE);

export interface OpsFeedFilters {
  severity?: OpsSeverity;
  tenantId?: string;
  types?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * Cross-tenant operational activity/alert feed for the platform admin. Reads the
 * domain_events log (the same stream the AI + monitoring use), filtered to the
 * platform-significant event types, so a super-admin sees churn, auto-suspensions,
 * plan changes, limit hits, paid invoices and anomalies across ALL tenants in one
 * place — instead of digging through the audit log.
 */
@Injectable()
export class PlatformOpsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private typesForSeverity(sev: OpsSeverity): string[] {
    return FEED_TYPES.filter((t) => SEVERITY_BY_TYPE[t] === sev);
  }

  async feed(filters: OpsFeedFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(filters.pageSize ?? 50, 200);
    const offset = (page - 1) * pageSize;

    // Resolve the effective type allowlist: explicit types ∩ known, else the
    // severity's types, else all platform types.
    let types = FEED_TYPES;
    if (filters.types?.length) types = filters.types.filter((t) => FEED_TYPES.includes(t));
    else if (filters.severity) types = this.typesForSeverity(filters.severity);
    if (types.length === 0) return { data: [], total: 0, page, pageSize, totalPages: 0 };

    const where: string[] = [`e.type = ANY($1::text[])`];
    const vals: unknown[] = [types];
    if (filters.tenantId) { vals.push(filters.tenantId); where.push(`e.tenant_id = $${vals.length}`); }
    const whereClause = `WHERE ${where.join(' AND ')}`;

    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM domain_events e ${whereClause}`,
      vals,
    );
    const total = parseInt(countRes.rows[0]!.count, 10);

    const dataRes = await this.pool.query(
      `SELECT e.id, e.created_at, e.type, e.tenant_id, e.outlet_id, e.payload, e.actor,
              t.name AS tenant_name
         FROM domain_events e
         LEFT JOIN tenants t ON t.id = e.tenant_id
         ${whereClause}
         ORDER BY e.created_at DESC
         LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, pageSize, offset],
    );
    const data = dataRes.rows.map((x: any) => ({
      id: x.id,
      at: x.created_at,
      type: x.type,
      severity: SEVERITY_BY_TYPE[x.type] ?? 'info',
      tenantId: x.tenant_id,
      tenantName: x.tenant_name,
      outletId: x.outlet_id,
      actor: x.actor,
      payload: x.payload ?? {},
    }));
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Severity counts over the last 24h and 7d — powers the overview alert widget. */
  async alertsSummary(): Promise<{
    last24h: Record<OpsSeverity, number>;
    last7d: Record<OpsSeverity, number>;
  }> {
    const res = await this.pool.query<{ type: string; d1: string; d7: string }>(
      `SELECT type,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::text AS d1,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::text  AS d7
         FROM domain_events
        WHERE type = ANY($1::text[]) AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY type`,
      [FEED_TYPES],
    ).catch(() => ({ rows: [] as { type: string; d1: string; d7: string }[] }));

    const empty = (): Record<OpsSeverity, number> => ({ critical: 0, warning: 0, info: 0 });
    const last24h = empty();
    const last7d = empty();
    for (const r of res.rows) {
      const sev = SEVERITY_BY_TYPE[r.type] ?? 'info';
      last24h[sev] += parseInt(r.d1, 10);
      last7d[sev] += parseInt(r.d7, 10);
    }
    return { last24h, last7d };
  }
}
