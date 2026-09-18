import { describe, it, expect, vi } from 'vitest';
import { TenantScopedPool } from './tenant-scoped-pool';
import { runAsTenant, runPrivileged, runWithoutTenant } from './tenant-context';

/**
 * The pool wrapper is the single point every one of the 568 query sites passes
 * through once row-level security is enforced. Its contract:
 *
 *  - enforcement off      -> the owner pool, untouched. No SET, no checkout.
 *  - scoped to a tenant   -> a client, app.tenant_id assigned, query, reset,
 *                            release. The tenant id is a PARAMETER, never
 *                            interpolated.
 *  - runPrivileged        -> the owner pool, no scoping.
 *  - no context (default) -> the owner pool + one warning per origin, so a
 *                            scheduler keeps working instead of silently
 *                            reading nothing.
 *  - no context (strict)  -> throws, naming the query. How the remaining
 *                            context-less paths get found in testing.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

function fakePool(label: string) {
  const client = {
    label,
    query: vi.fn(async () => ({ rows: [{ from: label }], rowCount: 1 })),
    release: vi.fn(),
  };
  return {
    label,
    client,
    query: vi.fn(async () => ({ rows: [{ from: label }], rowCount: 1 })),
    connect: vi.fn(async () => client),
  };
}

describe('TenantScopedPool', () => {
  it('delegates untouched when enforcement is off', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(owner as never, owner as never, false);

    const res = await runAsTenant(TENANT, () => pool.query('SELECT 1'));

    expect(res.rows[0]).toEqual({ from: 'owner' });
    expect(owner.query).toHaveBeenCalledTimes(1);
    // The decisive part: no client was checked out and no SET was issued, so
    // behaviour is identical to the bare pool it replaced.
    expect(owner.connect).not.toHaveBeenCalled();
    expect(scoped.connect).not.toHaveBeenCalled();
  });

  it('scopes a tenant query: set, run, reset, release', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);

    const res = await runAsTenant(TENANT, () => pool.query('SELECT * FROM customers'), 'test',
      { role: 'cashier', outletId: 'outlet-9' });

    expect(res.rows[0]).toEqual({ from: 'scoped' });
    expect(owner.query).not.toHaveBeenCalled();

    const calls = scoped.client.query.mock.calls;
    expect(calls).toHaveLength(3);
    // All three settings the policies read, as bound parameters — never
    // concatenated into SQL.
    expect(calls[0]![0]).toContain("set_config('app.tenant_id', $1, false)");
    expect(calls[0]![0]).toContain("set_config('app.role', $2, false)");
    expect(calls[0]![0]).toContain("set_config('app.outlet_id', $3, false)");
    expect(calls[0]![1]).toEqual([TENANT, 'cashier', 'outlet-9']);
    expect(calls[1]![0]).toBe('SELECT * FROM customers');
    expect(calls[2]![0]).toMatch(/RESET app\.tenant_id/);
    expect(scoped.client.release).toHaveBeenCalledTimes(1);
  });

  it('sends role and outlet, because 7 policies read them', async () => {
    // outlets / orders / services / bays / employee_shifts / audit_logs grant
    // the whole tenant to an owner and otherwise confine the caller to one
    // outlet; `users` uses app.role to expose tenant-less platform rows. With
    // these unset a cashier sees no outlets at all — an empty application.
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);

    await runAsTenant(TENANT, () => pool.query('SELECT 1'), 'test', { role: 'tenant_owner' });

    const [, params] = scoped.client.query.mock.calls[0]!;
    expect(params).toEqual([TENANT, 'tenant_owner', '00000000-0000-0000-0000-000000000000']);
  });

  it('never sends an empty app.outlet_id', async () => {
    // The policies cast it with ::uuid and `''::uuid` raises "invalid input
    // syntax for type uuid", after which every later query on that connection
    // fails too. An owner has no outlet, so the all-zero UUID stands in: valid,
    // and matches no row.
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);

    for (const outletId of [null, undefined, '', '   ']) {
      scoped.client.query.mockClear();
      await runAsTenant(TENANT, () => pool.query('SELECT 1'), 'test', { outletId });
      const params = scoped.client.query.mock.calls[0]![1] as string[];
      expect(params[2]).toBe('00000000-0000-0000-0000-000000000000');
    }
  });

  it('releases and resets even when the query throws', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    scoped.client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // the SET
      .mockRejectedValueOnce(new Error('boom'))                   // the query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });          // the RESET
    const pool = new TenantScopedPool(scoped as never, owner as never, true);

    await expect(runAsTenant(TENANT, () => pool.query('SELECT bad'))).rejects.toThrow('boom');

    // A connection returned to the pool still carrying a tenant scope is how a
    // later query would silently read the wrong tenant.
    expect(String(scoped.client.query.mock.calls.at(-1)![0])).toMatch(/RESET app\.tenant_id/);
    expect(scoped.client.release).toHaveBeenCalledTimes(1);
  });

  it('runPrivileged bypasses scoping entirely', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);

    const res = await runPrivileged(() => pool.query('SELECT * FROM tenants'));

    expect(res.rows[0]).toEqual({ from: 'owner' });
    expect(scoped.connect).not.toHaveBeenCalled();
  });

  it('with no context: runs privileged and warns ONCE per origin', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);
    const warn = vi.spyOn((pool as never as { logger: { warn: (m: string) => void } }).logger, 'warn');

    await runWithoutTenant(() => pool.query('SELECT 1'));
    await runWithoutTenant(() => pool.query('SELECT 1'));

    // Kept working — a scheduler must not start reading zero rows silently.
    expect(owner.query).toHaveBeenCalledTimes(2);
    expect(scoped.connect).not.toHaveBeenCalled();
    // But it is visible, and not once per query.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/No tenant context/);
  });

  it('in STRICT mode a context-less query throws, naming the query', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true, true);

    await expect(runWithoutTenant(() => pool.query('SELECT * FROM orders WHERE id = $1', ['x'])))
      .rejects.toThrow(/no tenant context.*SELECT \* FROM orders/is);
    expect(owner.query).not.toHaveBeenCalled();
  });

  it('connect() hands back a client already scoped, and resets it on release', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);

    // connect() wraps client.release, so hold the underlying spy first.
    const underlyingRelease = scoped.client.release;
    const client = await runAsTenant(TENANT, () => pool.connect());

    expect(scoped.client.query.mock.calls[0]![1]).toEqual([
      TENANT, '', '00000000-0000-0000-0000-000000000000',
    ]);

    client.release();
    await new Promise((r) => setImmediate(r));
    expect(String(scoped.client.query.mock.calls.at(-1)![0])).toMatch(/RESET app\.tenant_id/);
    expect(underlyingRelease).toHaveBeenCalledTimes(1);

    // Double release must not double-reset or double-return the connection.
    client.release();
    await new Promise((r) => setImmediate(r));
    expect(underlyingRelease).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty tenant id at the boundary', () => {
    // '' would reach the policy as ''::uuid, raise "invalid input syntax for
    // type uuid", and keep erroring on that connection until it is reset.
    expect(() => runAsTenant('', () => undefined)).toThrow(/requires a tenant id/);
    expect(() => runAsTenant('   ', () => undefined)).toThrow(/requires a tenant id/);
  });

  it('keeps tenants apart across concurrent work', async () => {
    const scoped = fakePool('scoped');
    const owner = fakePool('owner');
    const pool = new TenantScopedPool(scoped as never, owner as never, true);
    const other = '22222222-2222-2222-2222-222222222222';

    await Promise.all([
      runAsTenant(TENANT, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return pool.query('SELECT a');
      }),
      runAsTenant(other, () => pool.query('SELECT b')),
    ]);

    // Each query carried its OWN tenant: async context must not bleed between
    // overlapping requests.
    const sets = scoped.client.query.mock.calls.filter((c) => String(c[0]).includes('set_config'));
    const pairs = sets.map((c) => (c[1] as string[])[0]);
    expect(new Set(pairs)).toEqual(new Set([TENANT, other]));
  });
});
