import { Injectable, Inject, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface BusinessUnitRecord {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

/** Tables whose `business_unit` column holds a unit code (migration 096). */
const USAGE_TABLES = ['services', 'orders', 'payment_methods', 'vehicle_queue'] as const;

/**
 * Tenant-owned business units (AIRIN-176).
 *
 * Before this, 'AIRE' and 'LEAD' were a CHECK constraint on four tables, so no
 * tenant could add a third line of business. Migration 096 dropped those CHECKs
 * and moved the allowed set into `business_units`; this service is what now
 * enforces it, which is why `assertValid` exists and why every writer of a
 * business_unit column must call it.
 */
@Injectable()
export class BusinessUnitService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(tenantId: string, includeInactive = true): Promise<BusinessUnitRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM business_units WHERE tenant_id = $1 ${includeInactive ? '' : 'AND is_active = true'}
       ORDER BY sort_order, code`,
      [tenantId],
    );
    return res.rows.map(this.map);
  }

  async create(
    tenantId: string,
    dto: { code: string; name: string; color?: string; sortOrder?: number },
  ): Promise<BusinessUnitRecord> {
    const code = this.normalizeCode(dto.code);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    try {
      const res = await this.pool.query(
        `INSERT INTO business_units (tenant_id, code, name, color, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, code, name, dto.color ?? '#1652F0', dto.sortOrder ?? 0],
      );
      return this.map(res.rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Business unit "${code}" already exists`);
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    id: string,
    patch: { name?: string; color?: string; sortOrder?: number; isActive?: boolean },
  ): Promise<BusinessUnitRecord> {
    const set: string[] = [];
    const v: unknown[] = [];
    let i = 1;
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      set.push(`name = $${i++}`); v.push(name);
    }
    if (patch.color !== undefined) { set.push(`color = $${i++}`); v.push(patch.color); }
    if (patch.sortOrder !== undefined) { set.push(`sort_order = $${i++}`); v.push(patch.sortOrder); }
    if (patch.isActive !== undefined) { set.push(`is_active = $${i++}`); v.push(patch.isActive); }
    if (set.length === 0) throw new BadRequestException('No fields to update');
    v.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE business_units SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`,
      v,
    );
    if (res.rows.length === 0) throw new NotFoundException('Business unit not found');
    return this.map(res.rows[0]);
  }

  /**
   * `code` is intentionally NOT editable. It is the value already stored on
   * every service, order, payment method and queue row; renaming it would
   * orphan history that no longer matches any unit. `name` is the display
   * label — that is the field a tenant actually wants to change.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    const found = await this.pool.query<{ code: string }>(
      'SELECT code FROM business_units WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    const code = found.rows[0]?.code;
    if (!code) throw new NotFoundException('Business unit not found');

    const usage = await this.countUsage(tenantId, code);
    if (usage > 0) {
      throw new ConflictException(
        `"${code}" is still used by ${usage} record(s). Deactivate it instead — deleting would leave history pointing at a unit that no longer exists.`,
      );
    }
    await this.pool.query('DELETE FROM business_units WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  }

  /** How many rows across the four business_unit columns still carry `code`. */
  async countUsage(tenantId: string, code: string): Promise<number> {
    const parts = USAGE_TABLES.map(
      (tbl) => `(SELECT COUNT(*) FROM ${tbl} WHERE tenant_id = $1 AND business_unit = $2)`,
    );
    const res = await this.pool.query<{ total: string }>(
      `SELECT (${parts.join(' + ')}) AS total`,
      [tenantId, code],
    );
    return Number(res.rows[0]?.total ?? 0);
  }

  /**
   * Throws unless `code` is a unit this tenant owns. This replaces the CHECK
   * constraints migration 096 dropped — without it an arbitrary string would
   * now be storable in a business_unit column.
   */
  async assertValid(tenantId: string, code: string): Promise<void> {
    const res = await this.pool.query(
      'SELECT 1 FROM business_units WHERE tenant_id = $1 AND code = $2',
      [tenantId, this.normalizeCode(code)],
    );
    if (res.rows.length === 0) {
      const known = (await this.list(tenantId)).map((b) => b.code).join(', ');
      throw new BadRequestException(
        `Invalid business unit: ${code}.${known ? ` Must be one of: ${known}` : ''}`,
      );
    }
  }

  private normalizeCode(raw: string): string {
    const code = (raw ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('code is required');
    if (code.length > 10) throw new BadRequestException('code must be 10 characters or fewer');
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      throw new BadRequestException('code may contain only letters, digits, hyphen and underscore');
    }
    return code;
  }

  private map = (r: {
    id: string; tenant_id: string; code: string; name: string;
    color: string | null; sort_order: number | null; is_active: boolean;
  }): BusinessUnitRecord => ({
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    color: r.color ?? '#1652F0',
    sortOrder: r.sort_order ?? 0,
    isActive: r.is_active,
  });
}
