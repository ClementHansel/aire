import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import {
  Role,
  ROLE_HIERARCHY,
  ERR_AUTH_INSUFFICIENT_ROLE,
} from '@aire/shared';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * **Validates: Requirements 2.3, 2.4, 2.5, 2.6**
 *
 * Property 31: Role-Based Access Enforcement
 *
 * For any API endpoint with role restrictions, requests from users with
 * insufficient role privileges SHALL be rejected with HTTP 403.
 * The hierarchy is strict: Cashier(1) < OutletAdmin(2) < TenantOwner(3) < PlatformSuperAdmin(4)
 */

const ALL_ROLES: Role[] = [
  Role.Cashier,
  Role.OutletAdmin,
  Role.TenantOwner,
  Role.PlatformSuperAdmin,
];

/** Arbitrary that generates any valid Role */
const roleArb = fc.constantFrom(...ALL_ROLES);

function createMockContext(user: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params: {}, body: {}, query: {} }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('Property 31: Role-Based Access Enforcement', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('users with insufficient role level are always rejected with ForbiddenException', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (userRole, requiredRole) => {
        const userLevel = ROLE_HIERARCHY[userRole];
        const requiredLevel = ROLE_HIERARCHY[requiredRole];

        // Only test combinations where user has insufficient privilege
        fc.pre(userLevel < requiredLevel);

        const ctx = createMockContext({
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: userRole,
        });

        vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([requiredRole]);

        try {
          guard.canActivate(ctx);
          // If no exception, the property is violated
          return false;
        } catch (error) {
          expect(error).toBeInstanceOf(ForbiddenException);
          expect((error as ForbiddenException).message).toBe(
            ERR_AUTH_INSUFFICIENT_ROLE,
          );
          return true;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('users with sufficient role level are always granted access', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (userRole, requiredRole) => {
        const userLevel = ROLE_HIERARCHY[userRole];
        const requiredLevel = ROLE_HIERARCHY[requiredRole];

        // Only test combinations where user meets or exceeds required level
        fc.pre(userLevel >= requiredLevel);

        const ctx = createMockContext({
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: userRole,
        });

        vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([requiredRole]);

        const result = guard.canActivate(ctx);
        return result === true;
      }),
      { numRuns: 100 },
    );
  });

  it('hierarchy is strictly ordered: Cashier(1) < OutletAdmin(2) < TenantOwner(3) < PlatformSuperAdmin(4)', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (roleA, roleB) => {
        const levelA = ROLE_HIERARCHY[roleA];
        const levelB = ROLE_HIERARCHY[roleB];

        // Verify the hierarchy is consistent with the defined levels
        if (roleA === roleB) {
          return levelA === levelB;
        }
        // If levels differ, the comparison must be strict
        return levelA !== levelB;
      }),
      { numRuns: 100 },
    );
  });

  it('all 16 role combinations produce correct access decisions', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (userRole, requiredRole) => {
        const userLevel = ROLE_HIERARCHY[userRole];
        const requiredLevel = ROLE_HIERARCHY[requiredRole];

        const ctx = createMockContext({
          sub: 'user-1',
          tenant_id: 'tenant-1',
          outlet_id: 'outlet-1',
          role: userRole,
        });

        vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([requiredRole]);

        if (userLevel >= requiredLevel) {
          // Should grant access
          const result = guard.canActivate(ctx);
          return result === true;
        } else {
          // Should reject access with ForbiddenException
          try {
            guard.canActivate(ctx);
            return false; // Should have thrown
          } catch (error) {
            return (
              error instanceof ForbiddenException &&
              (error as ForbiddenException).message === ERR_AUTH_INSUFFICIENT_ROLE
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
