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
 *   (home outlet ∪ every branch they're scheduled at ∪ their JWT outlet ∪ the
 *   branch of any shift they currently have open). If they request a branch
 *   inside that set it narrows to it; otherwise they get the set.
 *
 * This set gates far more than orders — reports, customers, finance and
 * inventory all scope through it — so it is deliberately kept to branches the
 * user is working at *now*, not everywhere they have ever worked.
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

  /**
   * Home outlet ∪ scheduled branches ∪ JWT outlet ∪ the branch of any currently
   * OPEN POS shift, for an outlet-bound user.
   *
   * The open-shift union matters because a shift can be opened at a branch
   * outside the operator's schedule/home outlet (covering another branch, or
   * off-schedule with a reason — see ShiftService.open), and orders are booked to
   * the shift's outlet. Without it a cashier working a cover shift can't see the
   * branch they are actively selling at.
   *
   * Deliberately scoped to OPEN shifts: unioning every branch the user has ever
   * run a shift at would hand a cashier permanent read access to that branch's
   * finance, inventory, customers and reports long after the cover ended. The
   * narrower "see the orders I rang up" guarantee (AIRIN-110) is enforced in
   * OrderListService via an operator-id predicate instead, which grants exactly
   * that and nothing more.
   */
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
    const shifts = await this.pool.query<{ outlet_id: string }>(
      `SELECT DISTINCT outlet_id FROM pos_shifts
       WHERE tenant_id = $1 AND operator_id = $2 AND status = 'open'`,
      [user.tenant_id, user.sub],
    );
    for (const r of shifts.rows) set.add(r.outlet_id);
    return [...set];
  }
}
