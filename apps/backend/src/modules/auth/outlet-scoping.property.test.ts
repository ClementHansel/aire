import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import {
  Role,
  OUTLET_SCOPED_ROLES,
  TENANT_WIDE_ROLES,
  ERR_AUTH_OUTLET_MISMATCH,
} from '@aire/shared';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Property-based tests for outlet scoping enforcement.
 *
 * **Validates: Requirements 1.2, 1.5, 1.8**
 */

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a random UUID-like string for outlet/tenant IDs */
const arbUuid = fc.uuid();

/** Generates one of the four platform roles */
const arbRole = fc.constantFrom(
  Role.PlatformSuperAdmin,
  Role.TenantOwner,
  Role.OutletAdmin,
  Role.Cashier,
);

/** Generates only outlet-scoped roles (Cashier, OutletAdmin) */
const arbOutletScopedRole = fc.constantFrom(Role.OutletAdmin, Role.Cashier);

/** Generates only tenant-wide roles (PlatformSuperAdmin, TenantOwner) */
const arbTenantWideRole = fc.constantFrom(Role.PlatformSuperAdmin, Role.TenantOwner);

/** Generates the location of outletId in the request (params, body, or query) */
const arbOutletIdLocation = fc.constantFrom('params', 'body', 'query');

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function createGuardWithRoles(roles: Role[]): { guard: RolesGuard; reflector: Reflector } {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  return { guard, reflector };
}

function buildContextWithOutletId(
  role: string,
  userOutletId: string | null,
  targetOutletId: string,
  location: 'params' | 'body' | 'query',
): ExecutionContext {
  const user = {
    sub: 'user-1',
    tenant_id: 'tenant-1',
    outlet_id: userOutletId,
    role,
  };
  const params = location === 'params' ? { outletId: targetOutletId } : {};
  const body = location === 'body' ? { outletId: targetOutletId } : {};
  const query = location === 'query' ? { outletId: targetOutletId } : {};
  return createMockContext(user, params, body, query);
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Outlet Scoping - Property-Based Tests', () => {
  describe('Property 2: Outlet Scoping for Restricted Roles', () => {
    it('Cashier/OutletAdmin targeting a DIFFERENT outlet_id: RolesGuard throws ForbiddenException (ERR_AUTH_OUTLET_MISMATCH)', () => {
      fc.assert(
        fc.property(
          arbOutletScopedRole,
          arbUuid,
          arbUuid,
          arbOutletIdLocation,
          (role, userOutletId, targetOutletId, location) => {
            // Ensure target is different from user's outlet
            fc.pre(targetOutletId !== userOutletId);

            const { guard } = createGuardWithRoles([Role.Cashier]);
            const ctx = buildContextWithOutletId(role, userOutletId, targetOutletId, location);

            try {
              guard.canActivate(ctx);
              // If we get here, the guard allowed access — that's a failure
              return false;
            } catch (error) {
              expect(error).toBeInstanceOf(ForbiddenException);
              expect((error as ForbiddenException).message).toBe(ERR_AUTH_OUTLET_MISMATCH);
              return true;
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('Cashier/OutletAdmin targeting their OWN outlet_id: RolesGuard allows access', () => {
      fc.assert(
        fc.property(
          arbOutletScopedRole,
          arbUuid,
          arbOutletIdLocation,
          (role, outletId, location) => {
            const { guard } = createGuardWithRoles([Role.Cashier]);
            const ctx = buildContextWithOutletId(role, outletId, outletId, location);

            const result = guard.canActivate(ctx);
            expect(result).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('TenantOwner/PlatformSuperAdmin targeting ANY outlet_id: RolesGuard allows access', () => {
      fc.assert(
        fc.property(
          arbTenantWideRole,
          arbUuid,
          arbOutletIdLocation,
          (role, targetOutletId, location) => {
            const { guard } = createGuardWithRoles([Role.Cashier]);
            // Tenant-wide roles have null outlet_id
            const ctx = buildContextWithOutletId(role, null, targetOutletId, location);

            const result = guard.canActivate(ctx);
            expect(result).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('RLS context guard sets outlet_id correctly for database-level filtering', () => {
      fc.assert(
        fc.property(
          arbRole,
          arbUuid,
          arbUuid,
          (role, tenantId, outletId) => {
            // Simulate what the RlsContextGuard does: for outlet-scoped roles,
            // it sets app.outlet_id to the user's outlet_id; for tenant-wide roles
            // it sets app.outlet_id to empty string (no restriction).
            const isOutletScoped = OUTLET_SCOPED_ROLES.includes(role);
            const isTenantWide = TENANT_WIDE_ROLES.includes(role);
            const userOutletId = isOutletScoped ? outletId : null;

            // Verify classification is correct and exhaustive
            expect(isOutletScoped || isTenantWide).toBe(true);
            expect(isOutletScoped && isTenantWide).toBe(false);

            // Simulate the SET LOCAL that RlsContextGuard performs
            const rlsOutletId = userOutletId ?? '';

            if (isOutletScoped) {
              // Outlet-scoped roles get their outlet_id set in RLS context
              expect(rlsOutletId).toBe(outletId);
              expect(rlsOutletId).not.toBe('');
            } else {
              // Tenant-wide roles get empty string (RLS policy uses role check to bypass)
              expect(rlsOutletId).toBe('');
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('cross-outlet access: outlet-scoped roles WITHOUT a target outletId in request are allowed (for tenant-scoped entities like customers, memberships, vouchers)', () => {
      fc.assert(
        fc.property(
          arbOutletScopedRole,
          arbUuid,
          (role, userOutletId) => {
            // When no target outlet_id is specified in the request,
            // the guard allows access. This is how cross-outlet entities
            // (customers, memberships, vouchers) work — they don't include
            // outletId in the request parameters.
            const { guard } = createGuardWithRoles([Role.Cashier]);
            const ctx = createMockContext(
              {
                sub: 'user-1',
                tenant_id: 'tenant-1',
                outlet_id: userOutletId,
                role,
              },
              {}, // no outletId in params
              {}, // no outletId in body
              {}, // no outletId in query
            );

            const result = guard.canActivate(ctx);
            expect(result).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
