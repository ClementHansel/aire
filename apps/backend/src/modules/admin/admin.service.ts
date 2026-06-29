import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Tenant status values matching database CHECK constraint.
 */
export type TenantStatus = 'active' | 'suspended' | 'cancelled';

/**
 * Tenant record as returned from the database.
 */
export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for creating a new tenant.
 */
export interface CreateTenantDto {
  name: string;
  slug: string;
  plan?: string;
  settings?: Record<string, unknown>;
}

/**
 * DTO for updating a tenant.
 */
export interface UpdateTenantDto {
  name?: string;
  slug?: string;
  plan?: string;
  settings?: Record<string, unknown>;
}

/**
 * Platform configuration record stored in a platform_config table or as a singleton.
 */
export interface PlatformConfig {
  defaultPlans: string[];
  pricingTiers: Record<string, unknown>[];
  featureFlags: Record<string, boolean>;
}

/**
 * Raw tenant row from the database.
 */
interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: TenantStatus;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Map a database row to a TenantRecord.
 */
function mapRowToTenant(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    status: row.status,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Admin Service.
 *
 * Provides platform-level tenant management operations restricted to Platform_Super_Admin.
 * Handles tenant CRUD, suspension/reactivation, and platform configuration.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
@Injectable()
export class AdminService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * List all tenants with status, plan, and creation date.
   * Requirement: 4.1
   */
  async listTenants(): Promise<TenantRecord[]> {
    const result = await this.pool.query<TenantRow>(`
      SELECT id, name, slug, plan, status, settings, created_at, updated_at
      FROM tenants
      ORDER BY created_at DESC
    `);

    return result.rows.map(mapRowToTenant);
  }

  /**
   * Create a new tenant.
   * Requirement: 4.2
   */
  async createTenant(dto: CreateTenantDto): Promise<TenantRecord> {
    if (!dto.name || !dto.slug) {
      throw new BadRequestException('name and slug are required');
    }

    const result = await this.pool.query<TenantRow>(
      `INSERT INTO tenants (name, slug, plan, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      [dto.name, dto.slug, dto.plan ?? 'standard', dto.settings ? JSON.stringify(dto.settings) : '{}'],
    );

    const row = result.rows[0];
    if (!row) {
      throw new BadRequestException('Failed to create tenant');
    }
    return mapRowToTenant(row);
  }

  /**
   * Update an existing tenant.
   * Requirement: 4.2
   */
  async updateTenant(tenantId: string, dto: UpdateTenantDto): Promise<TenantRecord> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (dto.name !== undefined) {
      setClauses.push(`name = $${paramIdx}`);
      params.push(dto.name);
      paramIdx++;
    }
    if (dto.slug !== undefined) {
      setClauses.push(`slug = $${paramIdx}`);
      params.push(dto.slug);
      paramIdx++;
    }
    if (dto.plan !== undefined) {
      setClauses.push(`plan = $${paramIdx}`);
      params.push(dto.plan);
      paramIdx++;
    }
    if (dto.settings !== undefined) {
      setClauses.push(`settings = $${paramIdx}`);
      params.push(JSON.stringify(dto.settings));
      paramIdx++;
    }

    if (setClauses.length === 0) {
      throw new BadRequestException('No fields provided for update');
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(tenantId);

    const result = await this.pool.query<TenantRow>(
      `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      params,
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return mapRowToTenant(row);
  }

  /**
   * Suspend a tenant. Sets status to 'suspended'.
   * Requirement: 4.2
   */
  async suspendTenant(tenantId: string): Promise<TenantRecord> {
    const result = await this.pool.query<TenantRow>(
      `UPDATE tenants SET status = 'suspended', updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) {
      // Check if the tenant exists but isn't in 'active' state
      const existing = await this.pool.query<{ status: string }>(
        `SELECT status FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (existing.rows.length === 0) {
        throw new NotFoundException(`Tenant ${tenantId} not found`);
      }
      throw new BadRequestException(
        `Tenant ${tenantId} cannot be suspended (current status: ${existing.rows[0]!.status})`,
      );
    }

    return mapRowToTenant(row);
  }

  /**
   * Reactivate a suspended tenant. Sets status back to 'active'.
   * Requirement: 4.2
   */
  async reactivateTenant(tenantId: string): Promise<TenantRecord> {
    const result = await this.pool.query<TenantRow>(
      `UPDATE tenants SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND status = 'suspended'
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) {
      const existing = await this.pool.query<{ status: string }>(
        `SELECT status FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (existing.rows.length === 0) {
        throw new NotFoundException(`Tenant ${tenantId} not found`);
      }
      throw new BadRequestException(
        `Tenant ${tenantId} cannot be reactivated (current status: ${existing.rows[0]!.status})`,
      );
    }

    return mapRowToTenant(row);
  }

  /**
   * Get platform configuration.
   * Requirement: 4.3
   */
  async getPlatformConfig(): Promise<PlatformConfig> {
    const result = await this.pool.query<{ config: PlatformConfig }>(`
      SELECT config FROM platform_config WHERE id = 'default' LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) {
      // Return default config if none exists
      return {
        defaultPlans: ['standard', 'premium', 'enterprise'],
        pricingTiers: [],
        featureFlags: {},
      };
    }

    return row.config;
  }

  /**
   * Update platform configuration.
   * Requirement: 4.3
   */
  async updatePlatformConfig(config: Partial<PlatformConfig>): Promise<PlatformConfig> {
    // Upsert the platform config
    const result = await this.pool.query<{ config: PlatformConfig }>(
      `INSERT INTO platform_config (id, config, updated_at)
       VALUES ('default', $1, NOW())
       ON CONFLICT (id) DO UPDATE SET
         config = platform_config.config || $1,
         updated_at = NOW()
       RETURNING config`,
      [JSON.stringify(config)],
    );

    const row = result.rows[0];
    if (!row) {
      throw new BadRequestException('Failed to update platform config');
    }
    return row.config;
  }
}
