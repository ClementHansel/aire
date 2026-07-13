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
 * modified between JWT claim and the session variable.
 *
 * NOTE: the guard sets the RLS GUCs via `SELECT set_config(name, $1, true)` with
 * the value passed as a BOUND PARAMETER (not interpolated into the SQL string),
 * so these tests inspect the bound params, not the SQL text.
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

interface RecordedCall {
  sql: string;
  params?: unknown[];
}

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

/** The value bound to a given set_config(name, ...) call, or undefined. */
function boundValueFor(calls: RecordedCall[], gucName: string): unknown {
  const call = calls.find((c) => c.sql.includes(`set_config('${gucName}'`));
  return call?.params?.[0];
}

describe('Property 1: Tenant Data Isolation', () => {
  let guard: RlsContextGuard;
  let mockPool: { connect: ReturnType<typeof vi.fn> };
  let mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  let calls: RecordedCall[];

  const recorder = (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    return Promise.resolve(undefined);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    mockClient = {
      query: vi.fn().mockImplementation(recorder),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    guard = new RlsContextGuard(mockPool as any);
  });

  it('for any tenant_id in JWT, the guard binds app.tenant_id to exactly that value', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        calls = [];
        mockClient.query.mockImplementation(recorder);

        const { ctx } = createMockContext(payload);
        const result = await guard.canActivate(ctx);

        expect(result).toBe(true);
        expect(boundValueFor(calls, 'app.tenant_id')).toBe(payload.tenant_id);
      }),
      { numRuns: 200 },
    );
  });

  it('tenant_id is never transformed, truncated, or modified between JWT and the session variable', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        calls = [];
        mockClient.query.mockImplementation(recorder);

        const { ctx } = createMockContext(payload);
        await guard.canActivate(ctx);

        const setTenantId = boundValueFor(calls, 'app.tenant_id') as string;
        // Byte-for-byte identical to the JWT claim.
        expect(setTenantId).toBe(payload.tenant_id);
        expect(setTenantId.length).toBe(payload.tenant_id.length);
      }),
      { numRuns: 200 },
    );
  });

  it('for any role, tenant_id is always propagated (no role-based bypass)', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        calls = [];
        mockClient.query.mockImplementation(recorder);

        const { ctx } = createMockContext(payload);
        const result = await guard.canActivate(ctx);

        expect(result).toBe(true);
        expect(boundValueFor(calls, 'app.tenant_id')).toBe(payload.tenant_id);
      }),
      { numRuns: 200 },
    );
  });

  it('guard sets all three session variables (tenant_id, outlet_id, role) for any valid payload', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        calls = [];
        mockClient.query.mockImplementation(recorder);

        const { ctx } = createMockContext(payload);
        const result = await guard.canActivate(ctx);

        expect(result).toBe(true);

        // All three GUCs must be bound.
        expect(boundValueFor(calls, 'app.tenant_id')).toBe(payload.tenant_id);
        // null outlet_id is bound as an empty string.
        expect(boundValueFor(calls, 'app.outlet_id')).toBe(payload.outlet_id ?? '');
        expect(boundValueFor(calls, 'app.role')).toBe(payload.role);
      }),
      { numRuns: 200 },
    );
  });

  it('BEGIN is always called before the set_config statements for transaction safety', async () => {
    await fc.assert(
      fc.asyncProperty(jwtPayloadArbitrary, async (payload) => {
        calls = [];
        mockClient.query.mockImplementation(recorder);

        const { ctx } = createMockContext(payload);
        await guard.canActivate(ctx);

        // BEGIN must be the first statement.
        expect(calls[0]?.sql).toBe('BEGIN');

        // All set_config statements must come after BEGIN.
        const beginIndex = calls.findIndex((c) => c.sql === 'BEGIN');
        const setConfigIndices = calls
          .map((c, i) => (c.sql.includes('set_config(') ? i : -1))
          .filter((i) => i !== -1);

        for (const idx of setConfigIndices) {
          expect(idx).toBeGreaterThan(beginIndex);
        }
      }),
      { numRuns: 200 },
    );
  });
});
