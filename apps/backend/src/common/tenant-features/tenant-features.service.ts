import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  TenantCapabilities,
  TenantVertical,
  asVertical,
  resolveCapabilities,
} from '@aire/shared';
import { DATABASE_POOL } from '../../modules/auth/database.provider';

/** How long a tenant's resolved capabilities are reused before re-reading.
 *  Matches EntitlementService — a vertical changes about once per tenant lifetime,
 *  so a short TTL costs nothing and keeps an admin change visible quickly. */
const TTL_MS = 30_000;

export interface TenantProfile {
  vertical: TenantVertical;
  capabilities: TenantCapabilities;
}

/**
 * Resolves what a tenant's business actually IS, so feature code can stop
 * assuming a car wash.
 *
 * Read this instead of branching on tenant name, slug or business-unit code.
 * The result is `tenants.vertical`'s preset overlaid with any explicit
 * `settings.features` override (see @aire/shared verticals.ts).
 *
 * Registered globally (TenantFeaturesModule) so any module can inject it without
 * adding a dependency edge.
 */
@Injectable()
export class TenantFeaturesService {
  private readonly cache = new Map<string, { profile: TenantProfile; at: number }>();

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async getProfile(tenantId: string | null | undefined): Promise<TenantProfile> {
    // No tenant in context (platform super-admin, unauthenticated public route):
    // fall back to the default preset rather than throwing, so callers can read
    // capabilities unconditionally.
    if (!tenantId) return this.defaults();

    const hit = this.cache.get(tenantId);
    const now = Date.now();
    if (hit && now - hit.at < TTL_MS) return hit.profile;

    const res = await this.pool
      .query<{ vertical: string | null; settings: Record<string, unknown> | null }>(
        `SELECT vertical, settings FROM tenants WHERE id = $1`,
        [tenantId],
      )
      .catch(() => ({ rows: [] as { vertical: string | null; settings: Record<string, unknown> | null }[] }));

    const row = res.rows[0];
    const vertical = asVertical(row?.vertical);
    const overrides = (row?.settings as { features?: Record<string, unknown> } | null)?.features ?? null;
    const profile: TenantProfile = { vertical, capabilities: resolveCapabilities(vertical, overrides) };

    this.cache.set(tenantId, { profile, at: now });
    return profile;
  }

  /** Convenience for the common single-flag check. */
  async can(tenantId: string | null | undefined, flag: 'vehicles' | 'bays' | 'lpr'): Promise<boolean> {
    return (await this.getProfile(tenantId)).capabilities[flag];
  }

  /** Drop a tenant's cached profile — call after changing vertical or features. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private defaults(): TenantProfile {
    const vertical = asVertical(undefined);
    return { vertical, capabilities: resolveCapabilities(vertical, null) };
  }
}
