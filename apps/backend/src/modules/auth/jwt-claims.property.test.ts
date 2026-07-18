import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  Role,
  JWTPayload,
  OUTLET_SCOPED_ROLES,
  TENANT_WIDE_ROLES,
  VALID_ROLES,
  ACCESS_TOKEN_EXPIRY_SECONDS,
} from '@aire/shared';
import { AuthService, UserRow } from './auth.service';

/**
 * Property 3: JWT Claims Completeness
 *
 * For any successfully authenticated user, verify JWT contains non-null user_id,
 * tenant_id, role, and outlet_id matches assignment (null only for
 * Platform_Super_Admin/Tenant_Owner).
 *
 * **Validates: Requirements 1.3, 2.2**
 */

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: { compare: vi.fn() },
  compare: vi.fn(),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-token-id',
}));

// Mock ioredis
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};
// Regular function (not arrow) so `new Redis()` is constructable under vitest 4.
vi.mock('ioredis', () => {
  const Redis = vi.fn(function () { return mockRedis; });
  return { default: Redis, Redis };
});

// ─── Arbitraries ────────────────────────────────────────────────────────────────

/** Generate a valid UUID-like string */
const arbUuid = fc.uuid();

/** Generate a valid role from the enum */
const arbRole = fc.constantFrom(...VALID_ROLES);

/** Generate a tenant-wide role (PlatformSuperAdmin, TenantOwner) */
const arbTenantWideRole = fc.constantFrom(...TENANT_WIDE_ROLES);

/** Generate an outlet-scoped role (OutletAdmin, Cashier) */
const arbOutletScopedRole = fc.constantFrom(...OUTLET_SCOPED_ROLES);

/**
 * Generate a valid UserRow for outlet-scoped roles (must have outlet_id).
 */
const arbOutletScopedUser: fc.Arbitrary<UserRow> = fc.record({
  id: arbUuid,
  tenant_id: arbUuid,
  outlet_id: arbUuid.map((id) => id as string | null),
  email: fc.emailAddress(),
  password_hash: fc.constant('$2b$10$hashed'),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  role: arbOutletScopedRole as fc.Arbitrary<UserRow['role']>,
  is_active: fc.constant(true),
});

/**
 * Generate a valid UserRow for tenant-wide roles (outlet_id must be null).
 */
const arbTenantWideUser: fc.Arbitrary<UserRow> = fc.record({
  id: arbUuid,
  tenant_id: arbUuid,
  outlet_id: fc.constant(null),
  email: fc.emailAddress(),
  password_hash: fc.constant('$2b$10$hashed'),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  role: arbTenantWideRole as fc.Arbitrary<UserRow['role']>,
  is_active: fc.constant(true),
});

/**
 * Generate any valid user (both tenant-wide and outlet-scoped).
 */
const arbAnyUser: fc.Arbitrary<UserRow> = fc.oneof(arbTenantWideUser, arbOutletScopedUser);

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Property 3: JWT Claims Completeness', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let capturedPayloads: Array<Omit<JWTPayload, 'iat' | 'exp'>>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedPayloads = [];

    jwtService = {
      sign: vi.fn((payload: any) => {
        capturedPayloads.push(payload);
        return 'mock-jwt-token';
      }),
      verify: vi.fn(),
    } as any;

    const configService = {
      get: vi.fn((_key: string, defaultVal: any) => defaultVal),
    } as any;

    mockPool = { query: vi.fn() };
    // Default for any query beyond the per-test findUserByEmail Once mock — notably
    // login()'s tenant-lifecycle status lookup, which must resolve to 'active' so
    // the login proceeds (the per-test mockResolvedValueOnce still wins the 1st call).
    mockPool.query.mockResolvedValue({ rows: [{ status: 'active' }] });
    mockRedis.set.mockResolvedValue('OK');

    authService = new AuthService(jwtService, configService, mockPool as any);
  });

  it('should always include non-null sub (user_id) in JWT for any authenticated user', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyUser, async (user) => {
        capturedPayloads = [];
        mockPool.query.mockResolvedValueOnce({ rows: [user] });
        const bcrypt = await import('bcrypt');
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        await authService.login({ email: user.email, password: 'any-password' });

        // login() signs an access token AND a refresh token; assert on the
        // access-token payload (the refresh payload carries `type: 'refresh'`).
        const payload = capturedPayloads.find((p) => (p as { type?: string }).type !== 'refresh')!;
        expect(payload).toBeDefined();
        expect(payload.sub).not.toBeNull();
        expect(payload.sub).not.toBeUndefined();
        expect(typeof payload.sub).toBe('string');
        expect(payload.sub.length).toBeGreaterThan(0);
        expect(payload.sub).toBe(user.id);
      }),
      { numRuns: 100 },
    );
  });

  it('should always include non-null tenant_id in JWT for any authenticated user', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyUser, async (user) => {
        capturedPayloads = [];
        mockPool.query.mockResolvedValueOnce({ rows: [user] });
        const bcrypt = await import('bcrypt');
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        await authService.login({ email: user.email, password: 'any-password' });

        // login() signs an access token AND a refresh token; assert on the
        // access-token payload (the refresh payload carries `type: 'refresh'`).
        const payload = capturedPayloads.find((p) => (p as { type?: string }).type !== 'refresh')!;
        expect(payload).toBeDefined();
        expect(payload.tenant_id).not.toBeNull();
        expect(payload.tenant_id).not.toBeUndefined();
        expect(typeof payload.tenant_id).toBe('string');
        expect(payload.tenant_id.length).toBeGreaterThan(0);
        expect(payload.tenant_id).toBe(user.tenant_id);
      }),
      { numRuns: 100 },
    );
  });

  it('should always include a valid role from the Role enum in JWT for any authenticated user', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyUser, async (user) => {
        capturedPayloads = [];
        mockPool.query.mockResolvedValueOnce({ rows: [user] });
        const bcrypt = await import('bcrypt');
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        await authService.login({ email: user.email, password: 'any-password' });

        // login() signs an access token AND a refresh token; assert on the
        // access-token payload (the refresh payload carries `type: 'refresh'`).
        const payload = capturedPayloads.find((p) => (p as { type?: string }).type !== 'refresh')!;
        expect(payload).toBeDefined();
        expect(payload.role).not.toBeNull();
        expect(payload.role).not.toBeUndefined();
        expect(VALID_ROLES).toContain(payload.role);
        expect(payload.role).toBe(user.role);
      }),
      { numRuns: 100 },
    );
  });

  it('should set outlet_id to non-null for outlet-scoped roles (OutletAdmin, Cashier)', async () => {
    await fc.assert(
      fc.asyncProperty(arbOutletScopedUser, async (user) => {
        capturedPayloads = [];
        mockPool.query.mockResolvedValueOnce({ rows: [user] });
        const bcrypt = await import('bcrypt');
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        await authService.login({ email: user.email, password: 'any-password' });

        // login() signs an access token AND a refresh token; assert on the
        // access-token payload (the refresh payload carries `type: 'refresh'`).
        const payload = capturedPayloads.find((p) => (p as { type?: string }).type !== 'refresh')!;
        expect(payload).toBeDefined();
        expect(OUTLET_SCOPED_ROLES).toContain(payload.role as Role);
        expect(payload.outlet_id).not.toBeNull();
        expect(payload.outlet_id).not.toBeUndefined();
        expect(typeof payload.outlet_id).toBe('string');
        expect((payload.outlet_id as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should set outlet_id to null for tenant-wide roles (PlatformSuperAdmin, TenantOwner)', async () => {
    await fc.assert(
      fc.asyncProperty(arbTenantWideUser, async (user) => {
        capturedPayloads = [];
        mockPool.query.mockResolvedValueOnce({ rows: [user] });
        const bcrypt = await import('bcrypt');
        (bcrypt.compare as any).mockResolvedValueOnce(true);

        await authService.login({ email: user.email, password: 'any-password' });

        // login() signs an access token AND a refresh token; assert on the
        // access-token payload (the refresh payload carries `type: 'refresh'`).
        const payload = capturedPayloads.find((p) => (p as { type?: string }).type !== 'refresh')!;
        expect(payload).toBeDefined();
        expect(TENANT_WIDE_ROLES).toContain(payload.role as Role);
        expect(payload.outlet_id).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
