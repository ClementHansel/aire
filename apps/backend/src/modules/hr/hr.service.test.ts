import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HrService } from './hr.service';

describe('HrService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let service: HrService;

  beforeEach(() => {
    pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    service = new HrService(pool as never, undefined as never);
  });

  /**
   * listSalespeople — the POS salesperson picker (AIRIN-179).
   *
   * Renaming someone under Users & Roles writes `users.name`. The picker read
   * `employees.name`, so the same person showed up under two different names
   * depending on which screen you were on, and the till kept crediting sales to
   * the old one.
   */
  describe('listSalespeople — name source', () => {
    it('prefers the linked login name over the employee record name', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'emp-1', name: 'Fitri Renamed', user_id: 'user-1' }],
      });
      const rows = await service.listSalespeople('tenant-1');

      const [sql] = pool.query.mock.calls[0]!;
      // The rename has to be resolved in SQL — the join is the fix.
      expect(sql as string).toContain('LEFT JOIN users u ON u.id = e.user_id');
      expect(sql as string).toContain('COALESCE(NULLIF(TRIM(u.name)');
      expect(rows).toEqual([{ id: 'emp-1', name: 'Fitri Renamed', userId: 'user-1' }]);
    });

    it('orders by the effective name, not the stale employee name', async () => {
      await service.listSalespeople('tenant-1');
      const [sql] = pool.query.mock.calls[0]!;
      expect(sql as string).toMatch(/ORDER BY COALESCE\(NULLIF\(TRIM\(u\.name\)/);
    });

    it('keeps staff who have no login, on their employee name', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'emp-2', name: 'Rohman', user_id: null }],
      });
      const rows = await service.listSalespeople('tenant-1');
      expect(rows).toEqual([{ id: 'emp-2', name: 'Rohman', userId: null }]);
    });

    it('scopes to a branch when one is given', async () => {
      await service.listSalespeople('tenant-1', 'outlet-a');
      const [sql, params] = pool.query.mock.calls[0]!;
      expect(sql as string).toContain('e.outlet_id =');
      expect(params as unknown[]).toContain('outlet-a');
    });
  });

  /**
   * getBranchContext — the branch picker at shift open (AIRIN-178).
   *
   * An unscoped list let a cashier open a till at a branch they have nothing to
   * do with; an over-scoped one would lock out an operator we hold no HR record
   * for, so the empty case deliberately falls back to every branch.
   */
  describe('getBranchContext — branch scoping', () => {
    it('restricts the branch list to the allowed set', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'outlet-a', name: 'Kota Wisata' }] }) // branches
        .mockResolvedValueOnce({ rows: [] }); // no employee record
      const ctx = await service.getBranchContext('tenant-1', 'user-1', ['outlet-a']);

      const [sql, params] = pool.query.mock.calls[0]!;
      expect(sql as string).toContain('id = ANY($2::uuid[])');
      expect((params as unknown[])[1]).toEqual(['outlet-a']);
      expect(ctx.branches).toEqual([{ id: 'outlet-a', name: 'Kota Wisata' }]);
    });

    it('passes null through for an owner, restricting nothing', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'outlet-a', name: 'A' }, { id: 'outlet-b', name: 'B' }] })
        .mockResolvedValueOnce({ rows: [] });
      const ctx = await service.getBranchContext('tenant-1', 'owner-1', null);

      const [, params] = pool.query.mock.calls[0]!;
      expect((params as unknown[])[1]).toBeNull();
      expect(ctx.branches).toHaveLength(2);
    });

    it('falls back to every branch when the allowed set is empty', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })                                    // scoped: nothing
        .mockResolvedValueOnce({ rows: [{ id: 'outlet-a', name: 'A' }] })       // fallback: all
        .mockResolvedValueOnce({ rows: [] });                                   // no employee record
      const ctx = await service.getBranchContext('tenant-1', 'user-1', []);

      // Otherwise an operator with no employee row gets an empty picker and
      // cannot open a shift at all.
      expect(ctx.branches).toEqual([{ id: 'outlet-a', name: 'A' }]);
    });
  });
});
