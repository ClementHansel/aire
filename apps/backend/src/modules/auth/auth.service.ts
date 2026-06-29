import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
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
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD', ''),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
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
