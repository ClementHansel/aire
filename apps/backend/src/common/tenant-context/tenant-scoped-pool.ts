import { Logger } from '@nestjs/common';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { currentTenantContext } from './tenant-context';

/**
 * A `Pool` stand-in that scopes every query to the tenant in flight.
 *
 * It is what `DATABASE_POOL` provides, so all 568 `pool.query(...)` call sites
 * and 29 `pool.connect()` sites are covered without being edited. Only those
 * two members of the Pool surface are used by this codebase (verified), so only
 * those two are implemented.
 *
 * ── Enforcement is opt-in ───────────────────────────────────────────────────
 * With `enforce` false — the default — every call is handed straight to the
 * underlying pool. Behaviour is then byte-for-byte what it was before this
 * class existed, which is what makes it safe to ship ahead of the rollout.
 *
 * ── Why SET rather than SET LOCAL ───────────────────────────────────────────
 * `SET LOCAL` needs a transaction, and these call sites issue bare statements.
 * A session-level `set_config` on a client held for the duration of the one
 * query is equivalent and needs no transaction. Measured on this schema:
 * re-scoping the same pooled connection works correctly, so nothing leaks
 * between queries — provided the value is assigned on EVERY checkout and never
 * inherited, which is what this class does.
 *
 * ── What happens with no context ────────────────────────────────────────────
 * The policies are fail-closed: with `app.tenant_id` unset a query returns zero
 * rows. For a scheduler that reads as "no memberships expired today" — silent,
 * wrong, and hard to notice. So a context-less query is NOT sent unscoped:
 *
 *   default      run it on the privileged connection and WARN once per origin.
 *                Every HTTP request is covered by TenantContextInterceptor, so
 *                what lands here is background work (schedulers, event-bus
 *                subscribers) that is cross-tenant by nature and behaves
 *                exactly as it does today. The warning is the work list for
 *                narrowing them to runAsTenant one at a time.
 *   RLS_STRICT   throw instead, naming the query. For tests and staging: this
 *                is how the remaining context-less paths get found, without a
 *                production outage being the discovery mechanism.
 *
 * Choosing "warn" over "throw" as the default is deliberate. The risk being
 * closed is a REQUEST serving another tenant's rows, and requests are all
 * scoped by the interceptor; throwing by default would instead mean flipping
 * the flag takes down every scheduler at once.
 */
export class TenantScopedPool {
  private readonly logger = new Logger(TenantScopedPool.name);

  /**
   * @param scoped     connection as the RLS-bound role (`aire_app`).
   * @param privileged connection as the owner (`aire`), which bypasses RLS.
   * @param enforce    false: delegate everything to `privileged`, unchanged.
   */
  /** Origins already warned about, so one chatty scheduler cannot flood the log. */
  private readonly warned = new Set<string>();

  constructor(
    private readonly scoped: Pool,
    private readonly privileged: Pool,
    private readonly enforce: boolean,
    /** Throw on a context-less query instead of running it privileged. */
    private readonly strict = false,
  ) {}

  /**
   * Assign the three settings the policies read, in one round trip.
   * Parameterised — never string-built from request data.
   *
   * `app.outlet_id` is never empty: the policies cast it with `::uuid`, and
   * `''::uuid` raises. The all-zero UUID is a valid value that matches no row,
   * which is the right meaning for "this caller has no single outlet".
   */
  private static readonly SET_CONTEXT =
    "SELECT set_config('app.tenant_id', $1, false),"
    + " set_config('app.role', $2, false),"
    + " set_config('app.outlet_id', $3, false)";

  private static readonly NO_OUTLET = '00000000-0000-0000-0000-000000000000';

  private static readonly RESET_CONTEXT =
    'RESET app.tenant_id; RESET app.role; RESET app.outlet_id';

  /** The three parameter values, in the order SET_CONTEXT expects them. */
  private static settings(ctx: { tenantId?: string; role?: string; outletId?: string | null }): string[] {
    return [
      ctx.tenantId ?? '',
      ctx.role ?? '',
      ctx.outletId && ctx.outletId.trim() ? ctx.outletId.trim() : TenantScopedPool.NO_OUTLET,
    ];
  }

  /**
   * Delegate to pg. `pg.Pool#query` is heavily overloaded (row-object mode vs
   * array mode); passing our loosely-typed arguments through picks the array
   * overload, so the call is cast once here rather than at each use.
   */
  private static exec<R extends QueryResultRow>(
    target: Pool | PoolClient,
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    const q = target.query as (
      t: string | { text: string; values?: unknown[] },
      v?: unknown[],
    ) => Promise<QueryResult<R>>;
    return values === undefined ? q.call(target, textOrConfig) : q.call(target, textOrConfig, values);
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    if (!this.enforce) return TenantScopedPool.exec<R>(this.privileged, textOrConfig, values);

    const ctx = currentTenantContext();
    if (ctx?.privileged) return TenantScopedPool.exec<R>(this.privileged, textOrConfig, values);

    const tenantId = ctx?.tenantId;
    if (!tenantId) return TenantScopedPool.exec<R>(this.fallback(textOrConfig, ctx), textOrConfig, values);

    const client = await this.scoped.connect();
    try {
      await client.query(TenantScopedPool.SET_CONTEXT, TenantScopedPool.settings(ctx));
      return await TenantScopedPool.exec<R>(client, textOrConfig, values);
    } finally {
      await this.resetAndRelease(client);
    }
  }

  /**
   * A client for a multi-statement transaction. The tenant is applied before
   * the caller gets it, and cleared when they release it.
   */
  async connect(): Promise<PoolClient> {
    if (!this.enforce) return this.privileged.connect();

    const ctx = currentTenantContext();
    if (ctx?.privileged) return this.privileged.connect();

    const tenantId = ctx?.tenantId;
    if (!tenantId) return this.fallback('connect()', ctx).connect();

    const client = await this.scoped.connect();
    try {
      await client.query(TenantScopedPool.SET_CONTEXT, TenantScopedPool.settings(ctx));
    } catch (e) {
      client.release();
      throw e;
    }

    // Callers release the client themselves; clear the scope as they do, so a
    // later checkout can never inherit this tenant.
    const release = client.release.bind(client);
    let released = false;
    (client as PoolClient).release = (...args: unknown[]) => {
      if (released) return;
      released = true;
      client.query(TenantScopedPool.RESET_CONTEXT)
        .catch(() => undefined)
        .finally(() => (release as (...a: unknown[]) => void)(...args));
    };
    return client;
  }

  /**
   * Which pool a context-less query runs on. Throws in strict mode; otherwise
   * the privileged one, warning once per distinct origin so the gap is visible
   * without the log being flooded.
   */
  private fallback(q: string | { text: string }, ctx?: { origin?: string }): Pool {
    if (this.strict) throw missingContext(q);
    const key = ctx?.origin ?? summarise(q);
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(
        `No tenant context; running on the privileged connection (RLS not applied). `
        + `Narrow this to runAsTenant, or mark it runPrivileged. Origin: ${key}`,
      );
    }
    return this.privileged;
  }

  private async resetAndRelease(client: PoolClient): Promise<void> {
    // Belt and braces: the next checkout re-assigns the value anyway, but a
    // connection sitting idle in the pool should not carry a tenant scope.
    try {
      await client.query(TenantScopedPool.RESET_CONTEXT);
    } catch (e) {
      this.logger.warn(`could not reset app.tenant_id: ${e instanceof Error ? e.message : String(e)}`);
    }
    client.release();
  }

  /** Shut both pools down (used on application shutdown and in tests). */
  async end(): Promise<void> {
    await Promise.all([
      this.scoped === this.privileged ? Promise.resolve() : this.scoped.end(),
      this.privileged.end(),
    ]);
  }
}

function summarise(q: string | { text: string }): string {
  return (typeof q === 'string' ? q : q.text).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function missingContext(q: string | { text: string }): Error {
  return new Error(
    'Query attempted with no tenant context while RLS enforcement is strict. '
    + 'Wrap the caller in runAsTenant(tenantId, …), or in runPrivileged(…) if it is '
    + `deliberately cross-tenant. Query: ${summarise(q)}`,
  );
}
