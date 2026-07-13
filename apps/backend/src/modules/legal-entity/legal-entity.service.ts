import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * A legal entity (PT) owned by a tenant. Branches (outlets) are assigned to one
 * of the tenant's legal entities; the entity carries the tax details used on
 * invoices/receipts.
 */
export interface LegalEntityRecord {
  id: string;
  tenantId: string;
  name: string;
  npwp: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertLegalEntityDto {
  name: string;
  npwp?: string | null;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

const COLUMNS =
  'id, tenant_id, name, npwp, address, phone, is_active, created_at, updated_at';

/**
 * Tenant-scoped CRUD for legal entities (PT). Every query is filtered by
 * tenant_id so one tenant can never read or mutate another's entities.
 */
@Injectable()
export class LegalEntityService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async findAll(tenantId: string, activeOnly = false): Promise<LegalEntityRecord[]> {
    const conditions = ['tenant_id = $1'];
    if (activeOnly) conditions.push('is_active = true');
    const res = await this.pool.query(
      `SELECT ${COLUMNS} FROM legal_entities WHERE ${conditions.join(' AND ')}
       ORDER BY name`,
      [tenantId],
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async findById(tenantId: string, id: string): Promise<LegalEntityRecord> {
    const res = await this.pool.query(
      `SELECT ${COLUMNS} FROM legal_entities WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Legal entity not found');
    return this.mapRow(res.rows[0]);
  }

  async create(tenantId: string, dto: UpsertLegalEntityDto): Promise<LegalEntityRecord> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    const res = await this.pool.query(
      `INSERT INTO legal_entities (tenant_id, name, npwp, address, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [tenantId, name, dto.npwp ?? null, dto.address ?? null, dto.phone ?? null, dto.isActive ?? true],
    ).catch((err: any) => {
      // 23505 = unique_violation on (tenant_id, name)
      if (err?.code === '23505') throw new BadRequestException('A legal entity with this name already exists');
      throw err;
    });
    return this.mapRow(res.rows[0]);
  }

  async update(tenantId: string, id: string, dto: Partial<UpsertLegalEntityDto>): Promise<LegalEntityRecord> {
    const set: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const col = (c: string, v: unknown) => { set.push(`${c} = $${i}`); values.push(v); i++; };
    if (dto.name !== undefined) {
      const name = dto.name?.trim();
      if (!name) throw new BadRequestException('Name cannot be empty');
      col('name', name);
    }
    if (dto.npwp !== undefined) col('npwp', dto.npwp);
    if (dto.address !== undefined) col('address', dto.address);
    if (dto.phone !== undefined) col('phone', dto.phone);
    if (dto.isActive !== undefined) col('is_active', dto.isActive);
    if (set.length === 0) return this.findById(tenantId, id);
    set.push('updated_at = NOW()');
    values.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE legal_entities SET ${set.join(', ')}
       WHERE id = $${i} AND tenant_id = $${i + 1}
       RETURNING ${COLUMNS}`,
      values,
    ).catch((err: any) => {
      if (err?.code === '23505') throw new BadRequestException('A legal entity with this name already exists');
      throw err;
    });
    if (res.rows.length === 0) throw new NotFoundException('Legal entity not found');
    return this.mapRow(res.rows[0]);
  }

  /**
   * Deletes a legal entity. Branches referencing it are un-assigned automatically
   * (outlets.legal_entity_id ON DELETE SET NULL).
   */
  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query(
      'DELETE FROM legal_entities WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    if (res.rowCount === 0) throw new NotFoundException('Legal entity not found');
  }

  private mapRow(r: any): LegalEntityRecord {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      npwp: r.npwp ?? null,
      address: r.address ?? null,
      phone: r.phone ?? null,
      isActive: r.is_active,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    };
  }
}
