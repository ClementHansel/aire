import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../modules/auth/database.provider';
import { JWTPayload, Role } from '@aire/shared';

/**
 * Resolves which branches (outlets) a user may see in management/read views.
 *
 * - tenant_owner / platform_super_admin span all branches; they may narrow to one
 *   by passing a requested outletId.
 * - outlet_admin / cashier are restricted to the branches they're assigned to
 *   (home outlet ∪ every branch they're scheduled at ∪ their JWT outlet). If they
 *   request a branch inside that set it narrows to it; otherwise they get the set.
 *
 * Return contract (for SQL filters of the form
 *   `AND ($n::uuid[] IS NULL OR outlet_id = ANY($n::uuid[]))`):
 *   - null      → no restriction (all tenant branches)
 *   - []        → no branches (returns nothing)
 *   - [ids...]  → restrict to those branches
 */
@Injectable()
export class ScopeService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async resolveOutletIds(user: JWTPayload, requestedOutletId?: string): Promise<string[] | null> {
    if (user.role === Role.TenantOwner || user.role === Role.PlatformSuperAdmin) {
      return requestedOutletId ? [requestedOutletId] : null;
    }
    const assigned = await this.assignedOutletIds(user);
    if (requestedOutletId && assigned.includes(requestedOutletId)) return [requestedOutletId];
    return assigned;
  }

  /** Home outlet ∪ scheduled branches ∪ JWT outlet, for an outlet-bound user. */
  async assignedOutletIds(user: JWTPayload): Promise<string[]> {
    const set = new Set<string>();
    if (user.outlet_id) set.add(user.outlet_id);
    const home = await this.pool.query<{ outlet_id: string | null }>(
      `SELECT outlet_id FROM employees WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [user.tenant_id, user.sub],
    );
    if (home.rows[0]?.outlet_id) set.add(home.rows[0].outlet_id);
    const sched = await this.pool.query<{ outlet_id: string }>(
      `SELECT DISTINCT s.outlet_id
       FROM employees e JOIN employee_schedules s ON s.employee_id = e.id
       WHERE e.tenant_id = $1 AND e.user_id = $2 AND s.outlet_id IS NOT NULL`,
      [user.tenant_id, user.sub],
    );
    for (const r of sched.rows) set.add(r.outlet_id);
    return [...set];
  }
}
