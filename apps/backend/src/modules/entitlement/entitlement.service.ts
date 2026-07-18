import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService, DomainEventType } from '../events';

/** Machine code returned when a plan quota blocks an action (FE branches on this). */
export const ERR_PLAN_LIMIT_REACHED = 'PLAN_LIMIT_REACHED';

/**
 * Countable resources a plan can cap. A limit that is absent, null, or <= 0 means
 * UNLIMITED. Add a resource here + a usage query in USAGE_SQL to make it enforceable.
 */
export const ENTITLEMENT_RESOURCES = [
  { key: 'outlets', label: 'Branches / outlets' },
  { key: 'users', label: 'Staff logins' },
] as const;

export type EntitlementResource = (typeof ENTITLEMENT_RESOURCES)[number]['key'];

/** Per-resource live-count query (tenant-scoped). */
const USAGE_SQL: Record<EntitlementResource, string> = {
  outlets: `SELECT COUNT(*)::int AS n FROM outlets WHERE tenant_id = $1`,
  // Login seats = every non-platform user of the tenant.
  users: `SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1 AND role <> 'platform_super_admin'`,
};

export interface ResourceUsage {
  key: EntitlementResource;
  label: string;
  used: number;
  limit: number | null; // null = unlimited
  unlimited: boolean;
  remaining: number | null;
  exceeded: boolean;
}

export interface EntitlementSnapshot {
  tenantId: string;
  plan: string | null;
  resources: ResourceUsage[];
}

const LIMITS_TTL_MS = 30_000;

/**
 * The entitlement engine: resolves a tenant's effective resource limits (plan
 * limits, overridable per-tenant via settings.entitlementOverrides) and enforces
 * them at write time. Without this, `platform_plans.limits` is decorative — plans
 * differ only on price. `assertWithin` is the guard every create-path calls.
 *
 * Reads platform_plans directly (no dependency on the admin module) so any feature
 * module can import it without a cycle.
 */
@Injectable()
export class EntitlementService {
  private readonly limitsCache = new Map<string, { limits: Record<string, number>; plan: string | null; at: number }>();

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly events: EventBusService,
  ) {}

  /** Effective limits for a tenant = plan limits overlaid with per-tenant overrides. */
  async resolveLimits(tenantId: string): Promise<{ limits: Record<string, number>; plan: string | null }> {
    const hit = this.limitsCache.get(tenantId);
    const now = Date.now();
    if (hit && now - hit.at < LIMITS_TTL_MS) return { limits: hit.limits, plan: hit.plan };

    const t = await this.pool.query<{ plan: string | null; settings: Record<string, unknown> }>(
      `SELECT plan, settings FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const plan = t.rows[0]?.plan ?? null;
    const overrides = ((t.rows[0]?.settings as any)?.entitlementOverrides ?? {}) as Record<string, number>;

    let planLimits: Record<string, number> = {};
    if (plan) {
      const p = await this.pool
        .query<{ limits: Record<string, number> }>(`SELECT limits FROM platform_plans WHERE code = $1 LIMIT 1`, [plan])
        .catch(() => ({ rows: [] as { limits: Record<string, number> }[] }));
      planLimits = (p.rows[0]?.limits && typeof p.rows[0]!.limits === 'object' ? p.rows[0]!.limits : {}) as Record<string, number>;
    }
    const limits = { ...planLimits, ...overrides };
    this.limitsCache.set(tenantId, { limits, plan, at: now });
    return { limits, plan };
  }

  private async usage(tenantId: string, resource: EntitlementResource): Promise<number> {
    const r = await this.pool.query<{ n: number }>(USAGE_SQL[resource], [tenantId]);
    return r.rows[0]?.n ?? 0;
  }

  /** true when a positive limit exists and adding `delta` would exceed it. */
  private overCap(limit: number | undefined, used: number, delta: number): boolean {
    return typeof limit === 'number' && limit > 0 && used + delta > limit;
  }

  /**
   * Throw PLAN_LIMIT_REACHED if creating `delta` more of `resource` would exceed
   * the tenant's plan cap. No-op when the resource is uncapped. Call this at the
   * top of every create path for a limited resource.
   */
  async assertWithin(tenantId: string, resource: EntitlementResource, delta = 1): Promise<void> {
    const { limits, plan } = await this.resolveLimits(tenantId);
    const limit = limits[resource];
    if (!limit || limit <= 0) return; // uncapped
    const used = await this.usage(tenantId, resource);
    if (this.overCap(limit, used, delta)) {
      const label = ENTITLEMENT_RESOURCES.find((r) => r.key === resource)?.label ?? resource;
      await this.events.emit({
        type: DomainEventType.TenantLimitReached,
        tenantId,
        payload: { resource, plan, limit, used },
      }).catch(() => undefined);
      throw new ForbiddenException({
        statusCode: 403,
        error: ERR_PLAN_LIMIT_REACHED,
        resource,
        limit,
        used,
        message: `Your ${plan ?? 'current'} plan allows up to ${limit} ${label.toLowerCase()}. Upgrade your plan to add more.`,
      });
    }
  }

  /** Usage-vs-limit for every resource — powers the admin + tenant billing views. */
  async snapshot(tenantId: string): Promise<EntitlementSnapshot> {
    const { limits, plan } = await this.resolveLimits(tenantId);
    const resources: ResourceUsage[] = [];
    for (const { key, label } of ENTITLEMENT_RESOURCES) {
      const limit = limits[key];
      const capped = typeof limit === 'number' && limit > 0;
      const used = await this.usage(tenantId, key);
      resources.push({
        key,
        label,
        used,
        limit: capped ? limit : null,
        unlimited: !capped,
        remaining: capped ? Math.max(0, limit - used) : null,
        exceeded: capped ? used > limit : false,
      });
    }
    return { tenantId, plan, resources };
  }

  invalidate(tenantId: string): void {
    this.limitsCache.delete(tenantId);
  }
}
