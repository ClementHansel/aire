import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Outlet settings stored as JSONB in the database.
 * Contains service charge, tax, and void window configuration.
 */
export interface OutletSettings {
  service_charge_pct?: number;
  tax_pct?: number;
  free_void_window_minutes?: number;
  [key: string]: unknown;
}

/**
 * DTO for creating a new outlet.
 */
export interface CreateOutletDto {
  tenantId: string;
  name: string;
  agentId?: string;
  code?: string;
  legalEntity?: string;
  address?: string;
  phone?: string;
  mapsUrl?: string;
  timezone?: string;
  isActive?: boolean;
  settings?: OutletSettings;
}

/**
 * DTO for updating an existing outlet.
 */
export interface UpdateOutletDto {
  name?: string;
  agentId?: string;
  code?: string;
  legalEntity?: string;
  address?: string;
  phone?: string;
  mapsUrl?: string;
  timezone?: string;
  isActive?: boolean;
  settings?: OutletSettings;
}

/**
 * Outlet record as returned from the database.
 */
export interface OutletRecord {
  id: string;
  tenantId: string;
  name: string;
  agentId: string;
  code: string | null;
  legalEntity: string | null;
  address: string | null;
  phone: string | null;
  mapsUrl: string | null;
  timezone: string;
  isActive: boolean;
  settings: OutletSettings;
  createdAt: string;
  updatedAt: string;
}

/** Shared column projection so every query returns the same shape. */
const OUTLET_COLUMNS =
  'id, tenant_id, name, agent_id, code, legal_entity, address, phone, maps_url, timezone, is_active, settings, created_at, updated_at';

/**
 * OutletService handles CRUD operations for outlets, including
 * activation and deactivation.
 *
 * Requirement 3.1: Management of all Outlets within the Tenant
 *   including creating, editing, and deactivating Outlets.
 * Requirement 4.1: Display list of all Tenants (outlets listed per tenant).
 * Requirement 4.2: Manage tenants and their outlets.
 */
@Injectable()
export class OutletService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Creates a new outlet for a tenant.
   * Requirement 3.1: Creating outlets within a tenant.
   */
  async create(dto: CreateOutletDto): Promise<OutletRecord> {
    // Derive a 3-letter branch code from the name when not supplied.
    const code = (dto.code ?? dto.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
    // Agent id must be unique; auto-generate from the code when not provided.
    const agentId = dto.agentId ?? `${code.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.pool.query(
      `INSERT INTO outlets (tenant_id, name, agent_id, code, legal_entity, address, phone, maps_url, timezone, is_active, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${OUTLET_COLUMNS}`,
      [
        dto.tenantId,
        dto.name,
        agentId,
        code,
        dto.legalEntity ?? null,
        dto.address ?? null,
        dto.phone ?? null,
        dto.mapsUrl ?? null,
        dto.timezone ?? 'Asia/Jakarta',
        dto.isActive ?? true,
        dto.settings ? JSON.stringify(dto.settings) : '{}',
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Returns all outlets, optionally filtered by tenant.
   * Requirement 3.1: Management of all Outlets within the Tenant.
   */
  async findAll(tenantId?: string): Promise<OutletRecord[]> {
    if (tenantId) {
      const result = await this.pool.query(
        `SELECT ${OUTLET_COLUMNS} FROM outlets WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map((row: any) => this.mapRow(row));
    }

    const result = await this.pool.query(
      `SELECT ${OUTLET_COLUMNS} FROM outlets
       ORDER BY created_at DESC`,
    );
    return result.rows.map((row: any) => this.mapRow(row));
  }

  /**
   * Returns an outlet by ID.
   * Throws NotFoundException if not found.
   */
  async findById(id: string): Promise<OutletRecord> {
    const result = await this.pool.query(
      `SELECT ${OUTLET_COLUMNS} FROM outlets WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Outlet with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Updates an outlet by ID.
   * Requirement 3.1: Editing outlets.
   */
  async update(id: string, dto: UpdateOutletDto): Promise<OutletRecord> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (dto.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      values.push(dto.name);
      paramIndex++;
    }

    if (dto.agentId !== undefined) {
      setClauses.push(`agent_id = $${paramIndex}`);
      values.push(dto.agentId);
      paramIndex++;
    }

    if (dto.code !== undefined) {
      setClauses.push(`code = $${paramIndex}`);
      values.push(dto.code.toUpperCase());
      paramIndex++;
    }

    if (dto.legalEntity !== undefined) {
      setClauses.push(`legal_entity = $${paramIndex}`);
      values.push(dto.legalEntity);
      paramIndex++;
    }

    if (dto.address !== undefined) {
      setClauses.push(`address = $${paramIndex}`);
      values.push(dto.address);
      paramIndex++;
    }

    if (dto.phone !== undefined) {
      setClauses.push(`phone = $${paramIndex}`);
      values.push(dto.phone);
      paramIndex++;
    }

    if (dto.mapsUrl !== undefined) {
      setClauses.push(`maps_url = $${paramIndex}`);
      values.push(dto.mapsUrl);
      paramIndex++;
    }

    if (dto.timezone !== undefined) {
      setClauses.push(`timezone = $${paramIndex}`);
      values.push(dto.timezone);
      paramIndex++;
    }

    if (dto.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex}`);
      values.push(dto.isActive);
      paramIndex++;
    }

    if (dto.settings !== undefined) {
      setClauses.push(`settings = $${paramIndex}`);
      values.push(JSON.stringify(dto.settings));
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const result = await this.pool.query(
      `UPDATE outlets SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING ${OUTLET_COLUMNS}`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Outlet with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Activates an outlet (sets is_active = true).
   * Requirement 3.1: Deactivating (and reactivating) Outlets.
   */
  async activate(id: string): Promise<OutletRecord> {
    const result = await this.pool.query(
      `UPDATE outlets SET is_active = true, updated_at = NOW()
       WHERE id = $1
       RETURNING ${OUTLET_COLUMNS}`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Outlet with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Deactivates an outlet (sets is_active = false).
   * Requirement 3.1: Deactivating Outlets.
   */
  async deactivate(id: string): Promise<OutletRecord> {
    const result = await this.pool.query(
      `UPDATE outlets SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING ${OUTLET_COLUMNS}`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Outlet with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Maps a raw database row to an OutletRecord.
   */
  private mapRow(row: any): OutletRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      agentId: row.agent_id,
      code: row.code ?? null,
      legalEntity: row.legal_entity ?? null,
      address: row.address,
      phone: row.phone ?? null,
      mapsUrl: row.maps_url ?? null,
      timezone: row.timezone,
      isActive: row.is_active,
      settings: row.settings ?? {},
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
  }
}
