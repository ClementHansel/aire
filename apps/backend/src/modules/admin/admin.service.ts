import { Injectable, Inject, Optional, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { resolveTenantModules, TENANT_MODULE_KEYS } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { assignTenantCode } from '../../common/tenant-code';
import { seedDefaultPaymentMethods } from '../payment-method/payment-method.defaults';
import { seedDefaultBusinessUnits } from '../business-unit/business-unit.defaults';
import { seedDefaultChartOfAccounts } from '../accounting/chart-of-accounts.defaults';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';
import { LegalEntityService } from '../legal-entity/legal-entity.service';
import { OutletService } from '../outlet/outlet.service';
import { EventBusService, DomainEventType } from '../events';

/**
 * Tenant status values matching database CHECK constraint.
 */
export type TenantStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';

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
 * DTO for creating a new tenant. Beyond the tenant row the admin can provision
 * the owner login (so the tenant can sign in) and pre-fill the first legal
 * entity + branch, kicking off the onboarding wizard partway done.
 */
export interface CreateTenantDto {
  name: string;
  slug: string;
  plan?: string;
  settings?: Record<string, unknown>;
  /** Module enablement map (key → enabled); merged into settings.featureFlags. */
  modules?: Record<string, boolean>;
  /** Owner login to create. Optional for back-compat, but the admin UI sends it. */
  owner?: { name: string; email: string; password: string };
  /** Optional legal-entity (PT) pre-fill. */
  legalEntity?: { name: string; npwp?: string | null; address?: string | null; phone?: string | null };
  /** Optional first-branch pre-fill. */
  branch?: { name: string; code?: string; address?: string; phone?: string; serviceChargePct?: number; taxPct?: number };
}

/** What createTenant provisioned, so the admin UI can confirm/relay. */
export interface CreateTenantResult extends TenantRecord {
  ownerCreated: boolean;
  legalEntityId: string | null;
  branchId: string | null;
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
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly legalEntities: LegalEntityService,
    private readonly outlets: OutletService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Resolve a tenant identifier that may be either a UUID or a slug into its
   * canonical UUID. Admin URLs use the human-readable slug (e.g. `airin-demo`)
   * instead of the opaque UUID, so every `:id` admin endpoint funnels through
   * this. A well-formed UUID is returned as-is (no DB round-trip).
   */
  async resolveTenantId(idOrSlug: string): Promise<string> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(idOrSlug)) return idOrSlug;
    const r = await this.pool.query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug = $1',
      [idOrSlug],
    );
    if (r.rows.length === 0) throw new NotFoundException('Tenant not found');
    return r.rows[0]!.id;
  }

  /**
   * POV pickers for the super-admin hub "view as" feature: the tenant's
   * employees that have a linked login (so /employee resolves them) and its
   * customers (with a derived member flag). Both capped for a quick dropdown.
   */
  async listPovTargets(tenantId: string): Promise<{
    employees: { id: string; name: string; role: string | null; outletName: string | null }[];
    customers: { id: string; name: string; phone: string; isMember: boolean }[];
  }> {
    const [emp, cust] = await Promise.all([
      this.pool.query<{ id: string; name: string; role: string | null; outlet_name: string | null }>(
        `SELECT e.id, e.name, e.role, o.name AS outlet_name
           FROM employees e
           LEFT JOIN outlets o ON o.id = e.outlet_id
          WHERE e.tenant_id = $1 AND e.user_id IS NOT NULL AND e.status = 'active'
          ORDER BY e.name ASC
          LIMIT 100`,
        [tenantId],
      ),
      this.pool.query<{ id: string; name: string; phone: string; is_member: boolean }>(
        `SELECT c.id, c.name, c.phone,
                EXISTS (
                  SELECT 1 FROM memberships m
                   WHERE m.customer_id = c.id
                     AND m.status = 'active' AND m.end_date >= CURRENT_DATE
                ) AS is_member
           FROM customers c
          WHERE c.tenant_id = $1
          ORDER BY c.created_at DESC
          LIMIT 100`,
        [tenantId],
      ),
    ]);
    return {
      employees: emp.rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        outletName: r.outlet_name,
      })),
      customers: cust.rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        isMember: r.is_member,
      })),
    };
  }

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
   * Create a new tenant and (optionally) its owner login + first legal entity /
   * branch. Unlike the bare insert this replaces, it seeds the operational
   * defaults (payment methods, chart of accounts) the same way self-service
   * register does — so an admin-created tenant is actually usable. The tenant is
   * left with onboarding INCOMPLETE, so the owner is guided through the rest.
   * Requirement: 4.2
   */
  async createTenant(dto: CreateTenantDto): Promise<CreateTenantResult> {
    if (!dto.name || !dto.slug) {
      throw new BadRequestException('name and slug are required');
    }

    // Pre-flight: reject a duplicate owner email before creating the tenant, so
    // we don't leave an orphan tenant behind on conflict.
    const email = dto.owner?.email?.trim().toLowerCase();
    if (dto.owner) {
      if (!dto.owner.name?.trim() || !email || !dto.owner.password) {
        throw new BadRequestException('Owner name, email and password are required');
      }
      if (dto.owner.password.length < 8) {
        throw new BadRequestException('Owner password must be at least 8 characters');
      }
      const exists = await this.pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if ((exists.rowCount ?? 0) > 0) {
        throw new ConflictException('An account with this owner email already exists');
      }
    }

    const baseSettings = { ...DEFAULT_AUTOMATION_SETTINGS, ...(dto.settings ?? {}) };
    const result = await this.pool.query<TenantRow>(
      `INSERT INTO tenants (name, slug, plan, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, plan, status, settings, created_at, updated_at`,
      [dto.name, dto.slug, dto.plan ?? 'standard', JSON.stringify(baseSettings)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new BadRequestException('Failed to create tenant');
    }
    const tenantId = row.id;

    // Canonical code (feeds membership numbers) + operational defaults so the
    // tenant can take payment and the ledger has accounts from day one. All
    // non-fatal/idempotent, mirroring AuthService.register.
    await assignTenantCode(this.pool, tenantId).catch(() => undefined);
    await seedDefaultBusinessUnits(this.pool, tenantId).catch(() => undefined);
    await seedDefaultPaymentMethods(this.pool, tenantId).catch(() => undefined);
    await seedDefaultChartOfAccounts(this.pool, tenantId).catch(() => undefined);

    // Module enablement (only known keys are honored).
    if (dto.modules && Object.keys(dto.modules).length > 0) {
      await this.setTenantModules(tenantId, dto.modules).catch(() => undefined);
    }

    // Owner login.
    let ownerCreated = false;
    if (dto.owner && email) {
      const passwordHash = await bcrypt.hash(dto.owner.password, 10);
      await this.pool.query(
        `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, is_active)
         VALUES ($1, NULL, $2, $3, $4, 'tenant_owner', true)`,
        [tenantId, email, passwordHash, dto.owner.name.trim()],
      );
      ownerCreated = true;
    }

    // Optional legal-entity pre-fill (reuses the tenant-scoped service).
    let legalEntityId: string | null = null;
    if (dto.legalEntity?.name?.trim()) {
      const le = await this.legalEntities.create(tenantId, dto.legalEntity);
      legalEntityId = le.id;
    }

    // Optional first-branch pre-fill, assigned to the legal entity if created.
    let branchId: string | null = null;
    if (dto.branch?.name?.trim()) {
      const outlet = await this.outlets.create({
        tenantId,
        name: dto.branch.name,
        code: dto.branch.code,
        legalEntityId,
        address: dto.branch.address,
        phone: dto.branch.phone,
        settings: {
          ...(dto.branch.serviceChargePct != null ? { service_charge_pct: dto.branch.serviceChargePct } : {}),
          ...(dto.branch.taxPct != null ? { tax_pct: dto.branch.taxPct } : {}),
        },
      });
      branchId = outlet.id;
    }

    void this.eventBus?.emit({
      type: DomainEventType.TenantCreated,
      tenantId,
      actor: 'admin',
      payload: { name: row.name, slug: row.slug, plan: row.plan, source: 'admin' },
    });

    return { ...mapRowToTenant(row), ownerCreated, legalEntityId, branchId };
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

  // Tenant status transitions (suspend / reactivate / cancel / past_due) now live
  // in TenantLifecycleService — the single writer of tenants.status, which also
  // records history + emits domain events + invalidates the auth status cache.

  /**
   * Get the enabled/disabled state of every module for a tenant.
   * Modules default to enabled; only explicit `false` flags disable them.
   */
  async getTenantModules(tenantId: string): Promise<Record<string, boolean>> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    const flags = (row.settings?.featureFlags ?? {}) as Record<string, boolean>;
    return resolveTenantModules(flags);
  }

  /**
   * Enable/disable modules for a tenant. Merges the provided map into
   * tenants.settings.featureFlags, ignoring any unknown keys.
   */
  async setTenantModules(
    tenantId: string,
    modules: Record<string, boolean>,
  ): Promise<Record<string, boolean>> {
    const result = await this.pool.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const featureFlags = {
      ...((settings.featureFlags ?? {}) as Record<string, boolean>),
    };
    for (const [key, value] of Object.entries(modules)) {
      if (TENANT_MODULE_KEYS.includes(key)) {
        featureFlags[key] = Boolean(value);
      }
    }
    const nextSettings = { ...settings, featureFlags };

    await this.pool.query(
      `UPDATE tenants SET settings = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(nextSettings), tenantId],
    );
    return resolveTenantModules(featureFlags);
  }

  /**
   * Get platform configuration.
   * Requirement: 4.3
   */
  async getPlatformConfig(): Promise<PlatformConfig> {
    const defaults: PlatformConfig = {
      defaultPlans: ['standard', 'premium', 'enterprise'],
      pricingTiers: [],
      featureFlags: {},
    };

    let row: { config: PlatformConfig } | undefined;
    try {
      const result = await this.pool.query<{ config: PlatformConfig }>(`
        SELECT config FROM platform_config WHERE id = 'default' LIMIT 1
      `);
      row = result.rows[0];
    } catch {
      // Table may not exist yet (pre-migration) — fall back to defaults
      // rather than surfacing a 500 to the admin UI.
      return defaults;
    }

    if (!row) {
      return defaults;
    }

    // Merge stored config over defaults so partial rows still return a full shape.
    return { ...defaults, ...row.config };
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
