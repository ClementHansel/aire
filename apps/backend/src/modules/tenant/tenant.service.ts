import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Tenant settings stored as JSONB in the database.
 * Contains feature flags and payment configuration.
 */
export interface TenantSettings {
  featureFlags?: Record<string, boolean>;
  paymentConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * DTO for creating a new tenant.
 */
export interface CreateTenantDto {
  name: string;
  slug: string;
  plan?: string;
  status?: 'active' | 'suspended' | 'cancelled';
  settings?: TenantSettings;
}

/**
 * DTO for updating an existing tenant.
 */
export interface UpdateTenantDto {
  name?: string;
  slug?: string;
  plan?: string;
  status?: 'active' | 'suspended' | 'cancelled';
  settings?: TenantSettings;
}

/**
 * Tenant record as returned from the database.
 */
export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}

/**
 * TenantService handles CRUD operations for tenants.
 *
 * Requirement 3.1: Management of all Outlets within the Tenant.
 * Requirement 4.1: Display list of all Tenants with status, plan, creation date.
 * Requirement 4.2: Create, edit, suspend, and reactivate Tenants.
 */
@Injectable()
export class TenantService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Creates a new tenant.
   * Requirement 4.2: Create tenants.
   */
  async create(dto: CreateTenantDto): Promise<TenantRecord> {
    const result = await this.pool.query(
      `INSERT INTO tenants (name, slug, plan, status, settings)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      [
        dto.name,
        dto.slug,
        dto.plan ?? 'standard',
        dto.status ?? 'active',
        dto.settings ? JSON.stringify(dto.settings) : '{}',
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Returns all tenants.
   * Requirement 4.1: Display list of all Tenants with status, plan, creation date.
   */
  async findAll(): Promise<TenantRecord[]> {
    const result = await this.pool.query(
      `SELECT id, name, slug, plan, status, settings, created_at, updated_at
       FROM tenants
       ORDER BY created_at DESC`,
    );

    return result.rows.map((row: any) => this.mapRow(row));
  }

  /**
   * Returns a tenant by ID.
   * Throws NotFoundException if not found.
   */
  async findById(id: string): Promise<TenantRecord> {
    const result = await this.pool.query(
      `SELECT id, name, slug, plan, status, settings, created_at, updated_at
       FROM tenants WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Tenant with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Updates a tenant by ID.
   * Requirement 4.2: Edit, suspend, and reactivate Tenants.
   */
  async update(id: string, dto: UpdateTenantDto): Promise<TenantRecord> {
    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (dto.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      values.push(dto.name);
      paramIndex++;
    }

    if (dto.slug !== undefined) {
      setClauses.push(`slug = $${paramIndex}`);
      values.push(dto.slug);
      paramIndex++;
    }

    if (dto.plan !== undefined) {
      setClauses.push(`plan = $${paramIndex}`);
      values.push(dto.plan);
      paramIndex++;
    }

    if (dto.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      values.push(dto.status);
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
      `UPDATE tenants SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Tenant with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Maps a raw database row to a TenantRecord.
   */
  private mapRow(row: any): TenantRecord {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      plan: row.plan,
      status: row.status,
      settings: row.settings ?? {},
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
  }
}
