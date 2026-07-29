import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScopeService } from './scope.service';
import { Role, type JWTPayload } from '@aire/shared';

describe('ScopeService', () => {
  let scopeService: ScopeService;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };

  const cashier: JWTPayload = {
    sub: 'user-1',
    tenant_id: 'tenant-1',
    outlet_id: 'outlet-jwt',
    role: 'cashier',
    iat: 0,
  } as JWTPayload;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    scopeService = new ScopeService(mockPool as any);
  });

  describe('resolveOutletIds', () => {
    it('returns null (unrestricted) for tenant_owner with no requested outlet', async () => {
      const owner: JWTPayload = { ...cashier, role: Role.TenantOwner };
      const result = await scopeService.resolveOutletIds(owner);
      expect(result).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('narrows to the requested outlet for tenant_owner', async () => {
      const owner: JWTPayload = { ...cashier, role: Role.TenantOwner };
      const result = await scopeService.resolveOutletIds(owner, 'outlet-x');
      expect(result).toEqual(['outlet-x']);
    });

    it('returns null (unrestricted) for platform_super_admin with no requested outlet', async () => {
      const admin: JWTPayload = { ...cashier, role: Role.PlatformSuperAdmin };
      const result = await scopeService.resolveOutletIds(admin);
      expect(result).toBeNull();
    });

    it('narrows to the requested outlet for a cashier when it is within their assigned set', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-home' }] }) // home
        .mockResolvedValueOnce({ rows: [] }) // scheduled
        .mockResolvedValueOnce({ rows: [] }); // shifts
      const result = await scopeService.resolveOutletIds(cashier, 'outlet-home');
      expect(result).toEqual(['outlet-home']);
    });

    it('ignores a requested outlet outside the assigned set and returns the full set', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-home' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const result = await scopeService.resolveOutletIds(cashier, 'outlet-elsewhere');
      expect(result).toEqual(expect.arrayContaining(['outlet-jwt', 'outlet-home']));
      expect(result).toHaveLength(2);
    });
  });

  describe('assignedOutletIds', () => {
    it('unions JWT outlet, home outlet, scheduled branches, and POS-shift branches', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-home' }] }) // home
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-sched' }] }) // scheduled
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-shift' }] }); // shifts

      const result = await scopeService.assignedOutletIds(cashier);

      expect(result).toEqual(
        expect.arrayContaining(['outlet-jwt', 'outlet-home', 'outlet-sched', 'outlet-shift']),
      );
      expect(result).toHaveLength(4);
    });

    it('includes a shift outlet even when it is outside the home/schedule/JWT outlets (AIRIN-110)', async () => {
      // A cashier whose home/JWT outlet is branch A, but who opened (or has ever
      // opened) a POS shift at branch B — e.g. covering another branch. Orders
      // they ring there must not vanish from their own Orders list.
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-a' }] }) // home = A
        .mockResolvedValueOnce({ rows: [] }) // no schedule rows
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-b' }] }); // shift at B

      const cashierAtA: JWTPayload = { ...cashier, outlet_id: 'outlet-a' };
      const result = await scopeService.assignedOutletIds(cashierAtA);

      expect(result).toEqual(expect.arrayContaining(['outlet-a', 'outlet-b']));
      expect(result).toHaveLength(2);
    });

    it('de-duplicates when the shift outlet matches an already-assigned outlet', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-jwt' }] }) // home == jwt outlet
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-jwt' }] }); // shift == same outlet

      const result = await scopeService.assignedOutletIds(cashier);

      expect(result).toEqual(['outlet-jwt']);
    });

    it('queries pos_shifts scoped to tenant and operator', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await scopeService.assignedOutletIds(cashier);

      const shiftsCall = mockPool.query.mock.calls[2];
      expect(shiftsCall[0]).toMatch(/pos_shifts/);
      expect(shiftsCall[1]).toEqual([cashier.tenant_id, cashier.sub]);
    });

    it('returns an empty array when the user has no assignments at all', async () => {
      const noOutletUser: JWTPayload = { ...cashier, outlet_id: null };
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await scopeService.assignedOutletIds(noOutletUser);
      expect(result).toEqual([]);
    });
  });
});
