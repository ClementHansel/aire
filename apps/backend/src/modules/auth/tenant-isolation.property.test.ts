import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ExecutionContext } from '@nestjs/common';
import { RlsContextGuard } from '../../common/guards/rls-context.guard';
import { JWTPayload } from '@aire/shared';

/**
 * Property-Based Test: Tenant Data Isolation (Property 1)
 *
 * **Validates: Requirements 1.1, 1.2, 1.5, 1.6**
 *
 * Property: For any JWTPayload with tenant_id T, the RLS context guard sets
 * `app.tenant_id = T` — guaranteeing all subsequent RLS-filtered queries only
 * return data for tenant T.
 *
 * Additional property: No tenant_id value is ever transformed, truncated, or
 * modified between JWT claim and SET LOCAL statement.
 */

// --- Arbitraries ---

const uuidArbitrary = fc.uuid({ version: 4 });

const roleArbitrary = fc.constantFrom(
  'platform_super_admin' as const,
  'tenant_owner' as const,
  'outlet_admin' as const,
  'cashier' as const,
);

const jwtPayloadArbitrary: fc.Arbitrary<JWTPayload> = fc.record({
  sub: uuidArbitrary,
  tenant_id: uuidArbitrary,
  outlet_id: fc.oneof(uuidArbitrary, fc.constant(null)),
  role: roleArbitrary,
  iat: fc.integer({ min: 1_700_000_000, max: 2_000_000_000 }),
  exp: fc.integer({ min: 2_000_000_001, max: 2_100_000_000 }),
});

// --- Helpers ---

function createMockContext(user: JWTPayload | null): {
  ctx: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { user };
  return {
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext,
    request,
  };
}

describe('Property 1: Tenant Data Isolation', () => {
  let guard: RlsContextGuard;
  let mockPool: { connect: ReturnType<typeof vi.fn> };
  let mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  let queryCalls: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    queryCalls = [];

    mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        queryCalls.push(sql);
        return Promise.resolve(undefined);
      }),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    guard = new RlsContextGuard(mockPool as any);
  });

  it('for any tenant_id in JWT, the guard sets SET LOCAL app.tenant_id to exactly that value', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        // Reset tracking for each run
        queryCalls = [];
        mockClient.query.mockImplementation((sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve(undefined);
        });

        const { ctx } = createMockContext(payload);
        const result = await guard.canActivate(ctx);

        expect(result).toBe(true);

        // Find the SET LOCAL app.tenant_id statement
        const tenantIdStatement = queryCalls.find((q) =>
          q.startsWith('SET LOCAL app.tenant_id'),
        );

        expect(tenantIdStatement).toBeDefined();
        // The tenant_id from JWT must appear verbatim in the SET LOCAL statement
        expect(tenantIdStatement).toBe(
          `SET LOCAL app.tenant_id = '${payload.tenant_id}'`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('tenant_id is never transformed, truncated, or modified between JWT and SET LOCAL', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        queryCalls = [];
        mockClient.query.mockImplementation((sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve(undefined);
        });

        const { ctx } = createMockContext(payload);
        await guard.canActivate(ctx);

        const tenantIdStatement = queryCalls.find((q) =>
          q.startsWith('SET LOCAL app.tenant_id'),
        );

        // Extract the value set in the SQL statement
        const match = tenantIdStatement?.match(
          /SET LOCAL app\.tenant_id = '(.+)'/,
        );
        expect(match).not.toBeNull();

        const setTenantId = match![1];

        // The value must be byte-for-byte identical to the JWT claim
        expect(setTenantId).toBe(payload.tenant_id);
        expect(setTenantId.length).toBe(payload.tenant_id.length);
      }),
      { numRuns: 200 },
    );
  });

  it('for any role, tenant_id is always propagated (no role-based bypass)', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        queryCalls = [];
        mockClient.query.mockImplementation((sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve(undefined);
        });

        const { ctx } = createMockContext(payload);
        const result = await guard.canActivate(ctx);

        expect(result).toBe(true);

        // Regardless of role, tenant_id must always be set
        const tenantIdStatement = queryCalls.find((q) =>
          q.startsWith('SET LOCAL app.tenant_id'),
        );
        expect(tenantIdStatement).toBeDefined();

        // Verify it matches the JWT tenant_id exactly
        expect(tenantIdStatement).toBe(
          `SET LOCAL app.tenant_id = '${payload.tenant_id}'`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('guard sets all three session variables (tenant_id, outlet_id, role) for any valid payload', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        queryCalls = [];
        mockClient.query.mockImplementation((sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve(undefined);
        });

        const { ctx } = createMockContext(payload);
        const result = await guard.canActivate(ctx);

        expect(result).toBe(true);

        // All three session variables must be set
        const hasTenantId = queryCalls.some((q) =>
          q.startsWith('SET LOCAL app.tenant_id'),
        );
        const hasOutletId = queryCalls.some((q) =>
          q.startsWith('SET LOCAL app.outlet_id'),
        );
        const hasRole = queryCalls.some((q) =>
          q.startsWith('SET LOCAL app.role'),
        );

        expect(hasTenantId).toBe(true);
        expect(hasOutletId).toBe(true);
        expect(hasRole).toBe(true);

        // Verify outlet_id uses empty string for null
        const outletIdStatement = queryCalls.find((q) =>
          q.startsWith('SET LOCAL app.outlet_id'),
        );
        const expectedOutletId = payload.outlet_id ?? '';
        expect(outletIdStatement).toBe(
          `SET LOCAL app.outlet_id = '${expectedOutletId}'`,
        );

        // Verify role is propagated exactly
        const roleStatement = queryCalls.find((q) =>
          q.startsWith('SET LOCAL app.role'),
        );
        expect(roleStatement).toBe(
          `SET LOCAL app.role = '${payload.role}'`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('BEGIN is always called before SET LOCAL statements for transaction safety', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        queryCalls = [];
        mockClient.query.mockImplementation((sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve(undefined);
        });

        const { ctx } = createMockContext(payload);
        await guard.canActivate(ctx);

        // BEGIN must be the first statement
        expect(queryCalls[0]).toBe('BEGIN');

        // All SET LOCAL statements must come after BEGIN
        const beginIndex = queryCalls.indexOf('BEGIN');
        const setLocalIndices = queryCalls
          .map((q, i) => (q.startsWith('SET LOCAL') ? i : -1))
          .filter((i) => i !== -1);

        for (const idx of setLocalIndices) {
          expect(idx).toBeGreaterThan(beginIndex);
        }
      }),
      { numRuns: 200 },
    );
  });
});
