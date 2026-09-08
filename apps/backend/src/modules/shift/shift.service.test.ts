import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShiftService } from './shift.service';

/**
 * ShiftService.list — branch scoping (AIRIN-178).
 *
 * The POS "Recent shifts" panel and the dashboard shift history share this one
 * endpoint, so the scoping has to come from the caller's allowed branch set
 * rather than being hardcoded either way: an owner spans every branch, a
 * cashier sees only theirs.
 */
describe('ShiftService.list — branch scoping', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: ShiftService;

  /** The SQL text and params of the single SELECT the call issued. */
  const lastQuery = () => {
    const [sql, params] = pool.query.mock.calls[0]!;
    return { sql: sql as string, params: params as unknown[] };
  };

  beforeEach(() => {
    pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    service = new ShiftService(pool as never, undefined as never);
  });

  it('does not restrict by branch for an owner (outletIds null)', async () => {
    await service.list('tenant-1', { outletIds: null, operatorId: 'owner-1' });
    const { sql, params } = lastQuery();
    expect(sql).not.toContain('outlet_id = ANY');
    expect(params).not.toContain('owner-1');
  });

  it('restricts to the assigned branches, unioned with the operator’s own shifts', async () => {
    await service.list('tenant-1', { outletIds: ['outlet-a', 'outlet-b'], operatorId: 'cashier-1' });
    const { sql, params } = lastQuery();
    expect(sql).toContain('outlet_id = ANY');
    expect(sql).toContain('OR operator_id =');
    expect(params).toContainEqual(['outlet-a', 'outlet-b']);
    expect(params).toContain('cashier-1');
  });

  it('returns nothing rather than everything when the caller has no branches', async () => {
    // [] is the ScopeService contract for "no branches" — it must not degrade
    // into an unfiltered query, which is what leaked every branch's tills.
    await service.list('tenant-1', { outletIds: [] });
    const { sql, params } = lastQuery();
    expect(sql).toContain('outlet_id = ANY');
    expect(params).toContainEqual([]);
  });

  it('still honours an explicit single-branch filter', async () => {
    await service.list('tenant-1', { outletId: 'outlet-a', outletIds: null });
    const { sql, params } = lastQuery();
    expect(sql).toContain('outlet_id = $2');
    expect(params).toContain('outlet-a');
  });

  it('omits the branch predicate entirely when no scope is supplied', async () => {
    // Callers that predate the scoping (and internal callers) keep working.
    await service.list('tenant-1', {});
    const { sql } = lastQuery();
    expect(sql).not.toContain('outlet_id = ANY');
  });
});
