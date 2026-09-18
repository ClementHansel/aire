import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which tenant the work currently in flight belongs to.
 *
 * This exists so the database connection can be scoped without changing 568
 * call sites. Every service injects `DATABASE_POOL` and calls `pool.query(...)`
 * directly; there is no transaction to hang a `SET LOCAL` on and no request
 * object in reach. An AsyncLocalStorage store lets the pool wrapper
 * ({@link TenantScopedPool}) discover the tenant at query time instead.
 *
 * Read the accompanying doc in docs/DEPLOYMENT.md section 8 before changing
 * any of this: the failure mode of getting it wrong is that a tenant reads
 * another tenant's rows, or that a background job silently reads nothing.
 */

export interface TenantContext {
  /** The tenant whose data this work may touch. */
  tenantId?: string;
  /**
   * The caller's role, as `app.role`.
   *
   * Not decoration: 7 of the pre-existing policies read it —
   * `outlets`, `orders`, `services`, `bays`, `employee_shifts`, `audit_logs`
   * grant the whole tenant to `tenant_owner`/`platform_super_admin` and
   * otherwise restrict to one outlet, and `users` uses it to expose
   * tenant-less platform rows. Leave it unset and a cashier — or anyone —
   * sees no outlets, which reads as an empty application.
   */
  role?: string;
  /**
   * The caller's outlet, as `app.outlet_id`. Those same policies compare it to
   * `outlet_id`. Absent (an owner) it is written as the all-zero UUID rather
   * than left empty: the policies cast it with `::uuid`, and `''::uuid` raises
   * *invalid input syntax for type uuid*, which then breaks every later query
   * on that connection.
   */
  outletId?: string | null;
  /**
   * This work is deliberately cross-tenant (a platform/super-admin query, or a
   * scheduler sweeping every tenant) and runs on the privileged connection.
   * Set only via {@link runPrivileged} so every such place is greppable.
   */
  privileged?: boolean;
  /** Where the context came from, for diagnosing a missing one. */
  origin?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** The context for the work in flight, or undefined outside any. */
export function currentTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` scoped to one tenant. Queries inside it are executed on a connection
 * with `app.tenant_id` set, so row-level security confines them to that tenant.
 */
export function runAsTenant<T>(
  tenantId: string,
  fn: () => T,
  origin = 'explicit',
  extra: { role?: string; outletId?: string | null } = {},
): T {
  if (!tenantId || !tenantId.trim()) {
    // An empty string here would become `''::uuid` in the policy and raise
    // "invalid input syntax for type uuid", which then breaks every later query
    // on that connection until it is reset. Refuse it at the boundary instead.
    throw new Error('runAsTenant requires a tenant id');
  }
  return storage.run(
    { tenantId: tenantId.trim(), role: extra.role, outletId: extra.outletId ?? null, origin },
    fn,
  );
}

/**
 * Run `fn` on the PRIVILEGED connection, which bypasses row-level security.
 *
 * For work that is cross-tenant by nature: super-admin endpoints, the platform
 * ops feed, and the schedulers that sweep every tenant (membership expiry,
 * approval SLA, notification drain, broadcast). Prefer {@link runAsTenant} in a
 * loop when the work is really per-tenant — that keeps the backstop in place.
 */
export function runPrivileged<T>(fn: () => T, origin = 'privileged'): T {
  return storage.run({ privileged: true, origin }, fn);
}

/**
 * Run `fn` with NO tenant context, so any query through the scoped pool throws.
 * Used by tests to prove the loud-failure behaviour.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  return storage.run({ origin: 'none' }, fn);
}
