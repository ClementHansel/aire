import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../modules/auth/database.provider';

/**
 * Resolves a user's *effective* permission keys — the granular RBAC layer that
 * sits on top of the coarse role hierarchy (see RolesGuard).
 *
 * Model (deliberately zero-regression):
 *  - tenant_owner / platform_super_admin      → ['*'] (all permissions)
 *  - a user WITH a custom role assigned       → exactly that role's permission list
 *  - a user WITHOUT a custom role             → ['*'] (unrestricted at this layer;
 *                                                still bounded by the role hierarchy)
 *
 * So nothing changes for a tenant until its owner assigns a custom role to a
 * user — at which point the checkboxes in the Roles editor genuinely gate access.
 *
 * Results are cached briefly to avoid a DB round-trip on every request.
 */
export const WILDCARD = '*';

interface CacheEntry { keys: string[]; expires: number }

@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 15_000;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Effective permission keys for a user. `['*']` means "all". */
  async getEffectivePermissions(userId: string): Promise<string[]> {
    const cached = this.cache.get(userId);
    const now = Date.now();
    if (cached && cached.expires > now) return cached.keys;

    const res = await this.pool.query<{ role: string; custom_role_id: string | null; permissions: unknown }>(
      `SELECT u.role, u.custom_role_id, r.permissions
       FROM users u
       LEFT JOIN roles r ON r.id = u.custom_role_id
       WHERE u.id = $1`,
      [userId],
    );
    const row = res.rows[0];

    let keys: string[];
    if (!row) {
      keys = []; // Unknown user → no permissions (defensive; JwtAuthGuard should have caught this).
    } else if (row.role === 'tenant_owner' || row.role === 'platform_super_admin') {
      keys = [WILDCARD];
    } else if (row.custom_role_id) {
      keys = Array.isArray(row.permissions) ? (row.permissions as string[]) : [];
    } else {
      keys = [WILDCARD];
    }

    this.cache.set(userId, { keys, expires: now + this.ttlMs });
    return keys;
  }

  /** Whether a user holds at least one of the required keys (wildcard passes all). */
  async hasAny(userId: string, required: string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const keys = await this.getEffectivePermissions(userId);
    if (keys.includes(WILDCARD)) return true;
    return required.some((k) => keys.includes(k));
  }

  /** Invalidate a user's cached permissions (call after a role/user change). */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
