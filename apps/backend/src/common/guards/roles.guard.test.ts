import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { Role, ERR_AUTH_INSUFFICIENT_ROLE, ERR_AUTH_OUTLET_MISMATCH } from '@aire/shared';
import { RolesGuard } from './roles.guard';

function createMockContext(
  user: Record<string, unknown>,
  params: Record<string, string> = {},
  body: Record<string, string> = {},
  query: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params, body, query }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  describe('Role hierarchy enforcement', () => {
    it('should allow PlatformSuperAdmin access to any role-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: null,
        role: 'platform_super_admin',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow TenantOwner access to OutletAdmin-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: null,
        role: 'tenant_owner',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.OutletAdmin]);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow OutletAdmin access to Cashier-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'outlet_admin',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should deny Cashier access to OutletAdmin-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'cashier',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.OutletAdmin]);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx)).toThrow(ERR_AUTH_INSUFFICIENT_ROLE);
    });

    it('should deny Cashier access to TenantOwner-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'cashier',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.TenantOwner]);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should deny OutletAdmin access to TenantOwner-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'outlet_admin',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.TenantOwner]);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should deny OutletAdmin access to PlatformSuperAdmin-restricted endpoint', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'outlet_admin',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.PlatformSuperAdmin]);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should allow access when no roles decorator is present', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'cashier',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow access when roles array is empty', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'cashier',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('Outlet scoping enforcement', () => {
    it('should deny Cashier access when targeting a different outlet (params)', () => {
      const ctx = createMockContext(
        {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: 'cashier',
        },
        { outletId: 'outlet-2' },
      );
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx)).toThrow(ERR_AUTH_OUTLET_MISMATCH);
    });

    it('should deny OutletAdmin access when targeting a different outlet (body)', () => {
      const ctx = createMockContext(
        {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: 'outlet_admin',
        },
        {},
        { outletId: 'outlet-2' },
      );
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(() => guard.canActivate(ctx)).toThrow(ERR_AUTH_OUTLET_MISMATCH);
    });

    it('should deny Cashier access when targeting a different outlet (query)', () => {
      const ctx = createMockContext(
        {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: 'cashier',
        },
        {},
        {},
        { outletId: 'outlet-2' },
      );
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(() => guard.canActivate(ctx)).toThrow(ERR_AUTH_OUTLET_MISMATCH);
    });

    it('should allow Cashier access when targeting their own outlet', () => {
      const ctx = createMockContext(
        {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: 'cashier',
        },
        { outletId: 'outlet-1' },
      );
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow TenantOwner to access any outlet (bypass outlet scoping)', () => {
      const ctx = createMockContext(
        {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: null,
          role: 'tenant_owner',
        },
        { outletId: 'outlet-2' },
      );
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow PlatformSuperAdmin to access any outlet (bypass outlet scoping)', () => {
      const ctx = createMockContext(
        {
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: null,
          role: 'platform_super_admin',
        },
        { outletId: 'outlet-999' },
      );
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow Cashier when no outlet is targeted in request', () => {
      const ctx = createMockContext({
        sub: 'user-1',
        tenant_id: 'tenant-1',
        outlet_id: 'outlet-1',
        role: 'cashier',
      });
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.Cashier]);

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
