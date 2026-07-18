import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ERR_AUTH_INVALID_CREDENTIALS,
  ERR_AUTH_REFRESH_TOKEN_INVALID,
  ERR_AUTH_REFRESH_TOKEN_EXPIRED,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_SECONDS,
} from '@aire/shared';
import { AuthService } from './auth.service';

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
// A regular function (not an arrow) so `new Redis()` is constructable under
// vitest 4; returning an object from the constructor yields the mock.
vi.mock('ioredis', () => {
  const Redis = vi.fn(function () { return mockRedis; });
  return { default: Redis, Redis };
});

describe('AuthService', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const mockUser = {
    id: 'user-123',
    tenant_id: 'tenant-456',
    outlet_id: 'outlet-789',
    email: 'cashier@test.com',
    password_hash: '$2b$10$hashedpassword',
    name: 'Test Cashier',
    role: 'cashier' as const,
    is_active: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    jwtService = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
      verify: vi.fn(),
    } as any;

    configService = {
      get: vi.fn((_key: string, defaultVal: any) => defaultVal),
    } as any;

    mockPool = { query: vi.fn() };
    // Fallback for queries past the per-test Once mocks — chiefly the tenant-lifecycle
    // status lookup added to login()/validateJwtPayload(); 'active' lets auth proceed.
    mockPool.query.mockResolvedValue({ rows: [{ status: 'active' }] });

    authService = new AuthService(jwtService, configService, mockPool as any);
  });

  describe('login', () => {
    it('should return tokens and user info on valid credentials', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockUser] });
      const bcrypt = await import('bcrypt');
      (bcrypt.compare as any).mockResolvedValueOnce(true);
      mockRedis.set.mockResolvedValueOnce('OK');

      const result = await authService.login({
        email: 'cashier@test.com',
        password: 'validpassword',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toEqual({
        id: 'user-123',
        name: 'Test Cashier',
        role: 'cashier',
        tenantId: 'tenant-456',
        outletId: 'outlet-789',
      });
    });

    it('should throw UnauthorizedException for non-existent email', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        authService.login({ email: 'nobody@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw with correct error code for non-existent email', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        authService.login({ email: 'nobody@test.com', password: 'pass' }),
      ).rejects.toThrow(ERR_AUTH_INVALID_CREDENTIALS);
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockUser, is_active: false }],
      });

      await expect(
        authService.login({ email: 'cashier@test.com', password: 'pass' }),
      ).rejects.toThrow(ERR_AUTH_INVALID_CREDENTIALS);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockUser] });
      const bcrypt = await import('bcrypt');
      (bcrypt.compare as any).mockResolvedValueOnce(false);

      await expect(
        authService.login({ email: 'cashier@test.com', password: 'wrong' }),
      ).rejects.toThrow(ERR_AUTH_INVALID_CREDENTIALS);
    });

    it('should not include outletId for tenant-wide roles', async () => {
      const tenantOwner = { ...mockUser, outlet_id: null, role: 'tenant_owner' as const };
      mockPool.query.mockResolvedValueOnce({ rows: [tenantOwner] });
      const bcrypt = await import('bcrypt');
      (bcrypt.compare as any).mockResolvedValueOnce(true);
      mockRedis.set.mockResolvedValueOnce('OK');

      const result = await authService.login({
        email: 'cashier@test.com',
        password: 'pass',
      });

      expect(result.user.outletId).toBeUndefined();
    });

    it('should issue JWT with correct claims structure', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockUser] });
      const bcrypt = await import('bcrypt');
      (bcrypt.compare as any).mockResolvedValueOnce(true);
      mockRedis.set.mockResolvedValueOnce('OK');

      await authService.login({ email: 'cashier@test.com', password: 'pass' });

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'user-123',
          tenant_id: 'tenant-456',
          outlet_id: 'outlet-789',
          role: 'cashier',
        },
        { expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS },
      );
    });

    it('should store refresh token in Redis with correct key and TTL', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockUser] });
      const bcrypt = await import('bcrypt');
      (bcrypt.compare as any).mockResolvedValueOnce(true);
      mockRedis.set.mockResolvedValueOnce('OK');

      await authService.login({ email: 'cashier@test.com', password: 'pass' });

      expect(mockRedis.set).toHaveBeenCalledWith(
        'refresh:user-123:mock-uuid-token-id',
        '1',
        'EX',
        REFRESH_TOKEN_EXPIRY_SECONDS,
      );
    });
  });

  describe('refresh', () => {
    it('should issue new token pair and invalidate old refresh token', async () => {
      (jwtService.verify as any).mockReturnValueOnce({
        sub: 'user-123',
        tid: 'old-token-id',
        type: 'refresh',
      });
      mockRedis.get.mockResolvedValueOnce('1');
      mockRedis.del.mockResolvedValueOnce(1);
      mockPool.query.mockResolvedValueOnce({ rows: [mockUser] });
      mockRedis.set.mockResolvedValueOnce('OK');

      const result = await authService.refresh('valid-refresh-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockRedis.del).toHaveBeenCalledWith('refresh:user-123:old-token-id');
    });

    it('should throw if refresh token is invalid JWT', async () => {
      (jwtService.verify as any).mockImplementationOnce(() => {
        throw new Error('invalid token');
      });

      await expect(authService.refresh('invalid-token')).rejects.toThrow(
        ERR_AUTH_REFRESH_TOKEN_INVALID,
      );
    });

    it('should throw if refresh token not found in Redis (expired/rotated)', async () => {
      (jwtService.verify as any).mockReturnValueOnce({
        sub: 'user-123',
        tid: 'old-token-id',
        type: 'refresh',
      });
      mockRedis.get.mockResolvedValueOnce(null);

      await expect(authService.refresh('expired-token')).rejects.toThrow(
        ERR_AUTH_REFRESH_TOKEN_EXPIRED,
      );
    });

    it('should throw if user is no longer active after token rotation', async () => {
      (jwtService.verify as any).mockReturnValueOnce({
        sub: 'user-123',
        tid: 'old-token-id',
        type: 'refresh',
      });
      mockRedis.get.mockResolvedValueOnce('1');
      mockRedis.del.mockResolvedValueOnce(1);
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockUser, is_active: false }],
      });

      await expect(authService.refresh('valid-token')).rejects.toThrow(
        ERR_AUTH_REFRESH_TOKEN_INVALID,
      );
    });

    it('should throw if refresh token type claim is missing', async () => {
      (jwtService.verify as any).mockReturnValueOnce({
        sub: 'user-123',
        tid: 'old-token-id',
        // missing type: 'refresh'
      });

      await expect(authService.refresh('bad-type-token')).rejects.toThrow(
        ERR_AUTH_REFRESH_TOKEN_INVALID,
      );
    });
  });

  describe('validateJwtPayload', () => {
    it('should return the payload as-is', async () => {
      const payload = {
        sub: 'user-123',
        tenant_id: 'tenant-456',
        outlet_id: 'outlet-789',
        role: 'cashier' as const,
        iat: 1000,
        exp: 1900,
      };

      const result = await authService.validateJwtPayload(payload);
      expect(result).toEqual(payload);
    });
  });
});
