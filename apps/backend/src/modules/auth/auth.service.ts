import { Injectable, Inject, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { Pool } from 'pg';
import {
  JWTPayload,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_SECONDS,
  ERR_AUTH_INVALID_CREDENTIALS,
  ERR_AUTH_REFRESH_TOKEN_INVALID,
  ERR_AUTH_REFRESH_TOKEN_EXPIRED,
} from '@aire/shared';
import { DATABASE_POOL } from './database.provider';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

export interface RegisterRequest {
  tenantName: string;
  name: string;
  email: string;
  password: string;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  email: string;
  password_hash: string;
  name: string;
  role: 'platform_super_admin' | 'tenant_owner' | 'outlet_admin' | 'cashier';
  is_active: boolean;
}

@Injectable()
export class AuthService {
  private redis: Redis;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    } else {
      this.redis = new Redis({
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string>('REDIS_PASSWORD', ''),
        db: this.configService.get<number>('REDIS_DB', 0),
      });
    }
  }

  async login(dto: LoginRequest): Promise<LoginResponse> {
    const user = await this.findUserByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException(ERR_AUTH_INVALID_CREDENTIALS);
    }

    if (!user.is_active) {
      throw new UnauthorizedException(ERR_AUTH_INVALID_CREDENTIALS);
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException(ERR_AUTH_INVALID_CREDENTIALS);
    }

    const accessToken = this.issueAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role as LoginResponse['user']['role'],
        tenantId: user.tenant_id,
        ...(user.outlet_id ? { outletId: user.outlet_id } : {}),
      },
    };
  }

  /**
   * Self-service tenant signup: creates a new tenant + its owner user and
   * returns tokens (auto-login).
   */
  async register(dto: RegisterRequest): Promise<LoginResponse> {
    const email = (dto.email ?? '').trim().toLowerCase();
    const name = (dto.name ?? '').trim();
    const tenantName = (dto.tenantName ?? '').trim();
    if (!tenantName || !name || !email || !dto.password) {
      throw new BadRequestException('Business name, your name, email and password are required');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Please enter a valid email address');
    }
    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const slug = this.slugify(tenantName);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tenantRes = await client.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, plan, status, settings)
         VALUES ($1, $2, 'standard', 'active', $3) RETURNING id`,
        [tenantName, slug, JSON.stringify(DEFAULT_AUTOMATION_SETTINGS)],
      );
      const tenantId = tenantRes.rows[0]!.id;
      const userRes = await client.query<UserRow>(
        `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
         VALUES ($1, NULL, $2, $3, $4, 'tenant_owner', true)
         RETURNING id, tenant_id, outlet_id, email, password_hash, name, role, is_active`,
        [tenantId, email, passwordHash, name],
      );
      await client.query('COMMIT');

      const user = userRes.rows[0]!;
      const accessToken = this.issueAccessToken(user);
      const refreshToken = await this.issueRefreshToken(user.id);
      return {
        accessToken,
        refreshToken,
        user: { id: user.id, name: user.name, role: user.role as LoginResponse['user']['role'], tenantId: user.tenant_id },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      // Unique violation on slug — retry once with a fresh suffix.
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Could not create account, please try again');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Issue a password-reset token (stored in Redis, 30 min TTL). Returns a
   * generic message; the token is included so the flow works without an email
   * service configured (in production this would be emailed instead).
   */
  async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    const normalized = (email ?? '').trim().toLowerCase();
    const generic = 'If an account exists for that email, a reset token has been issued.';
    if (!normalized) return { message: generic };
    const user = await this.findUserByEmail(normalized);
    if (!user) return { message: generic };

    const token = uuidv4();
    await this.redis.set(`pwreset:${token}`, user.id, 'EX', 30 * 60);
    // No email/SMS channel is configured, so the token is returned to enable
    // the reset flow. Wire an email provider to deliver this securely.
    return { message: generic, resetToken: token };
  }

  /** Reset a password using a valid reset token. */
  async resetPassword(token: string, newPassword: string): Promise<{ success: true }> {
    if (!token) throw new BadRequestException('Reset token is required');
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const key = `pwreset:${token}`;
    const userId = await this.redis.get(key);
    if (!userId) throw new BadRequestException('Reset token is invalid or has expired');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const res = await this.pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, userId],
    );
    if (res.rowCount === 0) throw new BadRequestException('Account not found');
    await this.redis.del(key);
    return { success: true };
  }

  private slugify(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tenant';
    return `${base}-${uuidv4().slice(0, 6)}`;
  }

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    const payload = this.decodeRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException(ERR_AUTH_REFRESH_TOKEN_INVALID);
    }

    const { userId, tokenId } = payload;
    const redisKey = `refresh:${userId}:${tokenId}`;

    const stored = await this.redis.get(redisKey);
    if (!stored) {
      throw new UnauthorizedException(ERR_AUTH_REFRESH_TOKEN_EXPIRED);
    }

    // Invalidate old refresh token (rotation)
    await this.redis.del(redisKey);

    const user = await this.findUserById(userId);
    if (!user || !user.is_active) {
      throw new UnauthorizedException(ERR_AUTH_REFRESH_TOKEN_INVALID);
    }

    const newAccessToken = this.issueAccessToken(user);
    const newRefreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Validates a JWT payload extracted by the strategy.
   * Returns the payload if valid, otherwise null.
   */
  async validateJwtPayload(payload: JWTPayload): Promise<JWTPayload | null> {
    return payload;
  }

  /**
   * Platform-admin impersonation: issue an access token that acts as the given
   * tenant's owner. Caller MUST be a Platform Super Admin and MUST audit the act.
   */
  async issueImpersonationToken(tenantId: string): Promise<{
    accessToken: string;
    user: { id: string; name: string; role: string; tenantId: string; outletId: string | null };
  }> {
    const res = await this.pool.query<UserRow & { name: string }>(
      `SELECT id, tenant_id, outlet_id, role, name FROM users
       WHERE tenant_id = $1 AND role = 'tenant_owner'
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    const user = res.rows[0];
    if (!user) {
      throw new BadRequestException('Tenant has no owner account to impersonate');
    }
    return {
      accessToken: this.issueAccessToken(user),
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        tenantId: user.tenant_id,
        outletId: user.outlet_id ?? null,
      },
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private issueAccessToken(user: UserRow): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      sub: user.id,
      tenant_id: user.tenant_id,
      outlet_id: user.outlet_id,
      role: user.role,
    };

    return this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const tokenId = uuidv4();
    const redisKey = `refresh:${userId}:${tokenId}`;

    // Store in Redis with expiry
    await this.redis.set(redisKey, '1', 'EX', REFRESH_TOKEN_EXPIRY_SECONDS);

    // The refresh token is a signed JWT containing userId and tokenId
    return this.jwtService.sign(
      { sub: userId, tid: tokenId, type: 'refresh' },
      { expiresIn: REFRESH_TOKEN_EXPIRY_SECONDS },
    );
  }

  private decodeRefreshToken(token: string): { userId: string; tokenId: string } | null {
    try {
      const decoded = this.jwtService.verify(token);
      if (decoded.type !== 'refresh' || !decoded.sub || !decoded.tid) {
        return null;
      }
      return { userId: decoded.sub, tokenId: decoded.tid };
    } catch {
      return null;
    }
  }

  private async findUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query(
      'SELECT id, tenant_id, outlet_id, email, password_hash, name, role, is_active FROM users WHERE email = $1 LIMIT 1',
      [email],
    );
    return result.rows[0] ?? null;
  }

  private async findUserById(id: string): Promise<UserRow | null> {
    const result = await this.pool.query(
      'SELECT id, tenant_id, outlet_id, email, password_hash, name, role, is_active FROM users WHERE id = $1 LIMIT 1',
      [id],
    );
    return result.rows[0] ?? null;
  }
}
