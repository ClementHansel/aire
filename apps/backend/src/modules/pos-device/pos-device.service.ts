import { Injectable, Inject, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { DATABASE_POOL } from '../auth/database.provider';

export interface PosDeviceDTO {
  id: string;
  outletId: string;
  label: string | null;
  token: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Resolved by validate() — what a POS terminal needs to pin its branch. */
export interface PosDeviceContext {
  deviceId: string;
  tenantId: string;
  outletId: string;
  outletName: string;
  label: string | null;
}

/**
 * Admin management + token validation for registered POS terminals.
 * A device token proves the terminal is an authorized POS and resolves its
 * tenant + outlet; the cashier still signs in with email/password on top.
 */
@Injectable()
export class PosDeviceService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(tenantId: string): Promise<PosDeviceDTO[]> {
    const res = await this.pool.query(
      `SELECT id, outlet_id, label, token, is_active, last_seen_at, created_at
       FROM pos_devices WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return res.rows.map(this.map);
  }

  async create(tenantId: string, outletId: string, label?: string): Promise<PosDeviceDTO> {
    if (!outletId) throw new BadRequestException('outletId is required');
    // Verify the outlet belongs to this tenant before issuing a token for it.
    const outlet = await this.pool.query(
      `SELECT 1 FROM outlets WHERE id = $1 AND tenant_id = $2`,
      [outletId, tenantId],
    );
    if (outlet.rows.length === 0) throw new BadRequestException('Invalid outlet');

    const token = randomBytes(24).toString('hex');
    const res = await this.pool.query(
      `INSERT INTO pos_devices (tenant_id, outlet_id, label, token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, outlet_id, label, token, is_active, last_seen_at, created_at`,
      [tenantId, outletId, label ?? null, token],
    );
    return this.map(res.rows[0]);
  }

  async setActive(tenantId: string, id: string, isActive: boolean): Promise<PosDeviceDTO> {
    const res = await this.pool.query(
      `UPDATE pos_devices SET is_active = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, outlet_id, label, token, is_active, last_seen_at, created_at`,
      [id, tenantId, isActive],
    );
    if (res.rows.length === 0) throw new NotFoundException('POS device not found');
    return this.map(res.rows[0]);
  }

  /**
   * Validate an opaque device token (from the POS launch URL). Returns the
   * device's tenant/outlet so the terminal can pin its branch. Bumps last-seen.
   */
  async validate(token: string): Promise<PosDeviceContext> {
    if (!token) throw new UnauthorizedException('Missing POS device token');
    const res = await this.pool.query<{
      id: string; tenant_id: string; outlet_id: string; label: string | null; outlet_name: string;
    }>(
      `SELECT d.id, d.tenant_id, d.outlet_id, d.label, o.name AS outlet_name
       FROM pos_devices d JOIN outlets o ON o.id = d.outlet_id
       WHERE d.token = $1 AND d.is_active = true LIMIT 1`,
      [token],
    );
    const row = res.rows[0];
    if (!row) throw new UnauthorizedException('Invalid or disabled POS device token');
    // Best-effort liveness timestamp; never blocks the request.
    void this.pool
      .query(`UPDATE pos_devices SET last_seen_at = NOW() WHERE id = $1`, [row.id])
      .catch(() => undefined);
    return {
      deviceId: row.id,
      tenantId: row.tenant_id,
      outletId: row.outlet_id,
      outletName: row.outlet_name,
      label: row.label ?? null,
    };
  }

  private map = (r: any): PosDeviceDTO => ({
    id: r.id,
    outletId: r.outlet_id,
    label: r.label ?? null,
    token: r.token,
    isActive: r.is_active,
    lastSeenAt: r.last_seen_at ?? null,
    createdAt: r.created_at,
  });
}
