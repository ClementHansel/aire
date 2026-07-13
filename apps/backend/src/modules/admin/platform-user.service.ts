import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { DATABASE_POOL } from '../auth/database.provider';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreatePlatformUserDto {
  name: string;
  email: string;
  password: string;
}

/**
 * Manage platform-level operator accounts (platform_super_admin) and perform
 * privileged access resets on tenant owners. Platform admins have no tenant_id.
 */
@Injectable()
export class PlatformUserService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async listAdmins(): Promise<PlatformUser[]> {
    const r = await this.pool.query(
      `SELECT id, name, email, role, is_active, created_at
         FROM users WHERE role = 'platform_super_admin' ORDER BY created_at ASC`,
    );
    return r.rows.map((x: any) => this.map(x));
  }

  async createAdmin(dto: CreatePlatformUserDto): Promise<PlatformUser> {
    const email = (dto.email ?? '').trim().toLowerCase();
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('A valid email is required');
    if (!dto.password || dto.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      const r = await this.pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
           VALUES (NULL, $1, $2, $3, 'platform_super_admin', true)
         RETURNING id, name, email, role, is_active, created_at`,
        [email, passwordHash, name],
      );
      return this.map(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('A user with that email already exists');
      throw e;
    }
  }

  /** Enable/disable a platform admin. Callers must prevent self-deactivation. */
  async setActive(id: string, isActive: boolean): Promise<PlatformUser> {
    const r = await this.pool.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
         WHERE id = $2 AND role = 'platform_super_admin'
         RETURNING id, name, email, role, is_active, created_at`,
      [isActive, id],
    );
    if (r.rows.length === 0) throw new NotFoundException('Platform admin not found');
    return this.map(r.rows[0]);
  }

  /** Directly set a platform admin's password (privileged reset — no email token). */
  async setAdminPassword(id: string, newPassword: string): Promise<{ ok: true }> {
    if (!newPassword || newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const r = await this.pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW()
         WHERE id = $2 AND role = 'platform_super_admin'`,
      [passwordHash, id],
    );
    if (r.rowCount === 0) throw new NotFoundException('Platform admin not found');
    return { ok: true };
  }

  /** Reset the owner password for a tenant (support action). Targets the tenant_owner user. */
  async resetTenantOwnerPassword(tenantId: string, newPassword: string): Promise<{ ok: true; email: string }> {
    if (!newPassword || newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const owner = await this.pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE tenant_id = $1 AND role = 'tenant_owner' ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    if (owner.rows.length === 0) throw new NotFoundException('This tenant has no owner account');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, owner.rows[0]!.id]);
    return { ok: true, email: owner.rows[0]!.email };
  }

  private map(x: any): PlatformUser {
    return { id: x.id, name: x.name, email: x.email, role: x.role, isActive: x.is_active, createdAt: x.created_at };
  }
}
