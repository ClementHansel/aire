import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessService } from './access.service';

/**
 * Tenant/platform boundary on the /api/users surface (AIRIN-105).
 *
 * These endpoints are reachable by any tenant_owner, so anything that lets a
 * tenant see, assign, or modify `platform_super_admin` is an escalation path out
 * of their own tenant.
 */
describe('AccessService — tenant/platform user boundary', () => {
  let service: AccessService;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  const entitlements = { assertWithin: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'u1' }], rowCount: 1 }), release: vi.fn() };
    mockPool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn().mockResolvedValue(mockClient) };
    entitlements.assertWithin.mockResolvedValue(undefined);
    service = new AccessService(mockPool as any, entitlements as any);
  });

  describe('listUsers', () => {
    it('excludes AIRIN platform staff from a tenant user list', async () => {
      await service.listUsers('tenant-1');
      const [sql, params] = mockPool.query.mock.calls[0]!;
      expect(sql).toContain("role <> 'platform_super_admin'");
      // The flag that can bypass the filter must be off on the request path.
      expect(params).toEqual(['tenant-1', false]);
    });

    it('can include platform staff only when explicitly asked (post-write re-read)', async () => {
      await service.listUsers('tenant-1', true);
      const [, params] = mockPool.query.mock.calls[0]!;
      expect(params).toEqual(['tenant-1', true]);
    });

    it('always scopes to the caller tenant', async () => {
      await service.listUsers('tenant-1');
      const [sql] = mockPool.query.mock.calls[0]!;
      expect(sql).toContain('u.tenant_id = $1');
    });
  });

  describe('createUser', () => {
    it('refuses to mint a platform super-admin', async () => {
      await expect(
        service.createUser('tenant-1', {
          name: 'Escalate', email: 'e@x.com', password: 'pw', role: 'platform_super_admin',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('still accepts the roles a tenant legitimately assigns', async () => {
      for (const role of ['tenant_owner', 'outlet_admin', 'cashier']) {
        mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'u1', tenant_id: 'tenant-1', name: 'A', email: 'a@x.com', role, custom_role_id: null, is_active: true, outlet_ids: [] }] });
        await expect(
          service.createUser('tenant-1', { name: 'A', email: `${role}@x.com`, password: 'pw', role }),
        ).resolves.toBeDefined();
      }
    });

    it('rejects an unknown role', async () => {
      await expect(
        service.createUser('tenant-1', { name: 'A', email: 'a@x.com', password: 'pw', role: 'wizard' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateUser', () => {
    it('refuses to promote an existing user to platform super-admin', async () => {
      await expect(
        service.updateUser('tenant-1', 'user-1', { role: 'platform_super_admin' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cannot target a platform super-admin row', async () => {
      await service.updateUser('tenant-1', 'user-1', { name: 'Renamed' }).catch(() => { /* re-read is mocked loosely */ });
      const update = mockClient.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE users SET'));
      expect(update).toBeDefined();
      expect(update![0]).toContain("role <> 'platform_super_admin'");
    });
  });

  describe('deactivateUser', () => {
    it('cannot deactivate a platform super-admin', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await service.deactivateUser('tenant-1', 'user-1');
      const [sql] = mockPool.query.mock.calls[0]!;
      expect(sql).toContain("role <> 'platform_super_admin'");
    });

    it('reports not-found when nothing matched (including a shielded platform row)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.deactivateUser('tenant-1', 'platform-admin-id')).rejects.toThrow(NotFoundException);
    });
  });
});
