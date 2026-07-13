import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { DATABASE_POOL } from '../auth/database.provider';

export interface KioskDeviceDTO {
  id: string;
  outletId: string;
  label: string | null;
  token: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Admin management of self-service kiosk devices (token provisioning). */
@Injectable()
export class KioskDeviceService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(tenantId: string): Promise<KioskDeviceDTO[]> {
    const res = await this.pool.query(
      `SELECT id, outlet_id, label, token, is_active, last_seen_at, created_at
       FROM kiosk_devices WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return res.rows.map(this.map);
  }

  async create(tenantId: string, outletId: string, label?: string): Promise<KioskDeviceDTO> {
    if (!outletId) throw new BadRequestException('outletId is required');
    // Verify the outlet belongs to this tenant before issuing a token for it.
    const outlet = await this.pool.query(
      `SELECT 1 FROM outlets WHERE id = $1 AND tenant_id = $2`,
      [outletId, tenantId],
    );
    if (outlet.rows.length === 0) throw new BadRequestException('Invalid outlet');

    const token = randomBytes(24).toString('hex');
    const res = await this.pool.query(
      `INSERT INTO kiosk_devices (tenant_id, outlet_id, label, token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, outlet_id, label, token, is_active, last_seen_at, created_at`,
      [tenantId, outletId, label ?? null, token],
    );
    return this.map(res.rows[0]);
  }

  async setActive(tenantId: string, id: string, isActive: boolean): Promise<KioskDeviceDTO> {
    const res = await this.pool.query(
      `UPDATE kiosk_devices SET is_active = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, outlet_id, label, token, is_active, last_seen_at, created_at`,
      [id, tenantId, isActive],
    );
    if (res.rows.length === 0) throw new NotFoundException('Kiosk device not found');
    return this.map(res.rows[0]);
  }

  private map = (r: any): KioskDeviceDTO => ({
    id: r.id,
    outletId: r.outlet_id,
    label: r.label ?? null,
    token: r.token,
    isActive: r.is_active,
    lastSeenAt: r.last_seen_at ?? null,
    createdAt: r.created_at,
  });
}
