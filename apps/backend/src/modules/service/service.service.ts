import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { ServiceDTO, CreateServiceRequest, ServiceCategory, BusinessUnit } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { generateInStoreBarcode } from '../barcode/barcode.util';

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Query parameters for listing services.
 */
export interface ServiceQueryParams {
  tenantId: string;
  category?: ServiceCategory;
  businessUnit?: BusinessUnit;
  outletId?: string;
  active?: boolean;
  /** Exclude retail products (category='product'); they have their own API. */
  excludeProducts?: boolean;
}

/**
 * Reorder request: array of { id, sortOrder } pairs.
 */
export interface ReorderItem {
  id: string;
  sortOrder: number;
}

const VALID_CATEGORIES: string[] = [
  ServiceCategory.CarWash,
  ServiceCategory.Product,
  ServiceCategory.AddOn,
];

const VALID_BUSINESS_UNITS: string[] = [BusinessUnit.Aire, BusinessUnit.Lead];

@Injectable()
export class ServiceService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Creates a new service scoped to a tenant.
   * - car_wash category defaults to is_main_service = true.
   * - outlet_id null means available in all outlets.
   *
   * Requirements: 30.1, 30.2, 3.2
   */
  async create(tenantId: string, dto: CreateServiceRequest): Promise<ServiceDTO> {
    this.validateCategory(dto.category);
    const businessUnit = dto.businessUnit ?? BusinessUnit.Aire;
    this.validateBusinessUnit(businessUnit);
    this.validateDynamicDiscount(dto.dynamicDiscountEnabled, dto.dynamicDiscountKind, dto.maxDiscount);

    const isMainService =
      dto.isMainService !== undefined
        ? dto.isMainService
        : dto.category === ServiceCategory.CarWash;

    const barcode = await this.resolveBarcodeOnCreate(tenantId, dto);

    try {
      const result = await this.pool.query(
        `INSERT INTO services (tenant_id, outlet_id, name, category, business_unit, price, is_active, is_main_service, sort_order, category_id, brand_id, outlet_ids, barcode, dynamic_discount_enabled, dynamic_discount_kind, max_discount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id, tenant_id, outlet_id, name, category, business_unit, price, is_active, is_main_service, sort_order, category_id, brand_id, outlet_ids, barcode, dynamic_discount_enabled, dynamic_discount_kind, max_discount, created_at`,
        [
          tenantId,
          dto.outletId ?? null,
          dto.name,
          dto.category,
          businessUnit,
          dto.price,
          dto.isActive ?? true,
          isMainService,
          dto.sortOrder ?? 0,
          dto.categoryId ?? null,
          dto.brandId ?? null,
          dto.outletIds && dto.outletIds.length > 0 ? dto.outletIds : null,
          barcode,
          dto.dynamicDiscountEnabled ?? false,
          dto.dynamicDiscountKind ?? null,
          dto.maxDiscount ?? null,
        ],
      );

      return this.mapRow(result.rows[0]);
    } catch (err) {
      throw this.mapBarcodeError(err);
    }
  }

  /**
   * Determine the barcode for a new row: use the provided one (trimmed, or null
   * when blank); if none was given and the feature's autoGenerate is on for a
   * product, mint a unique EAN-13 in-store barcode. When the feature is off this
   * is a no-op, so existing product creation is unaffected.
   */
  private async resolveBarcodeOnCreate(tenantId: string, dto: CreateServiceRequest): Promise<string | null> {
    const provided = this.cleanBarcode(dto.barcode);
    if (provided) return provided;
    if (dto.category !== ServiceCategory.Product) return null;

    const cfg = await this.getBarcodeConfig(tenantId);
    if (!cfg.enabled || !cfg.autoGenerate) return null;

    // Base the sequence on how many services already carry a barcode, then walk
    // forward until we find one free of collision (defends against gaps/races).
    const countRes = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM services WHERE tenant_id = $1 AND barcode IS NOT NULL`,
      [tenantId],
    );
    let seq = parseInt(countRes.rows[0]?.n ?? '0', 10);
    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = generateInStoreBarcode(seq + attempt);
      const exists = await this.pool.query(
        `SELECT 1 FROM services WHERE tenant_id = $1 AND barcode = $2 LIMIT 1`,
        [tenantId, candidate],
      );
      if (exists.rows.length === 0) return candidate;
    }
    return null;
  }

  private cleanBarcode(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /** Read the tenant's barcode feature config (defaults OFF) without a hard dep. */
  private async getBarcodeConfig(tenantId: string): Promise<{ enabled: boolean; autoGenerate: boolean }> {
    const r = await this.pool.query<{ cfg: { enabled?: boolean; autoGenerate?: boolean } | null }>(
      `SELECT settings->'barcode' AS cfg FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const cfg = r.rows[0]?.cfg;
    return { enabled: cfg?.enabled ?? false, autoGenerate: cfg?.autoGenerate ?? false };
  }

  /** Turn a Postgres unique-barcode violation into a friendly 400. */
  private mapBarcodeError(err: unknown): unknown {
    if (
      err && typeof err === 'object' && 'code' in err &&
      (err as { code?: string }).code === PG_UNIQUE_VIOLATION &&
      String((err as { constraint?: string }).constraint ?? '').includes('barcode')
    ) {
      return new BadRequestException('Barcode already in use');
    }
    return err;
  }

  /**
   * Resolve a product/service by its barcode within a tenant. Optionally scope to
   * an outlet, honoring the same outlet visibility rules as findAll. Returns null
   * when nothing matches.
   */
  async findByBarcode(tenantId: string, code: string, outletId?: string): Promise<ServiceDTO | null> {
    const barcode = this.cleanBarcode(code);
    if (!barcode) return null;

    const conditions = ['tenant_id = $1', 'barcode = $2', 'is_active = true'];
    const values: unknown[] = [tenantId, barcode];
    if (outletId) {
      conditions.push(
        `(outlet_id = $3 OR (outlet_id IS NULL AND (outlet_ids IS NULL OR outlet_ids = '{}')) OR $3 = ANY(outlet_ids))`,
      );
      values.push(outletId);
    }
    const result = await this.pool.query(
      `SELECT id, tenant_id, outlet_id, name, category, business_unit, price, is_active, is_main_service, sort_order, category_id, brand_id, outlet_ids, barcode, dynamic_discount_enabled, dynamic_discount_kind, max_discount
       FROM services
       WHERE ${conditions.join(' AND ')}
       ORDER BY category, sort_order, name
       LIMIT 1`,
      values,
    );
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Lists services with optional filtering by category, outlet, and active status.
   * Services with outlet_id=null are available in all outlets, so they appear
   * when filtering by any specific outlet.
   *
   * Requirements: 30.2, 30.3
   */
  async findAll(params: ServiceQueryParams): Promise<ServiceDTO[]> {
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [params.tenantId];
    let paramIndex = 2;

    if (params.category) {
      conditions.push(`category = $${paramIndex}`);
      values.push(params.category);
      paramIndex++;
    } else if (params.excludeProducts) {
      conditions.push(`category <> $${paramIndex}`);
      values.push(ServiceCategory.Product);
      paramIndex++;
    }

    if (params.businessUnit) {
      conditions.push(`business_unit = $${paramIndex}`);
      values.push(params.businessUnit);
      paramIndex++;
    }

    if (params.outletId) {
      // Include services specific to this outlet, services available to all outlets
      // (outlet_id IS NULL and no outlet_ids restriction), and services whose
      // multi-branch scope (outlet_ids) contains this outlet.
      conditions.push(`(outlet_id = $${paramIndex} OR (outlet_id IS NULL AND (outlet_ids IS NULL OR outlet_ids = '{}')) OR $${paramIndex} = ANY(outlet_ids))`);
      values.push(params.outletId);
      paramIndex++;
    }

    if (params.active !== undefined) {
      conditions.push(`is_active = $${paramIndex}`);
      values.push(params.active);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await this.pool.query(
      `SELECT id, tenant_id, outlet_id, name, category, business_unit, price, is_active, is_main_service, sort_order, category_id, brand_id, outlet_ids, barcode, dynamic_discount_enabled, dynamic_discount_kind, max_discount
       FROM services
       WHERE ${whereClause}
       ORDER BY category, sort_order, name`,
      values,
    );

    return result.rows.map((row: any) => this.mapRow(row));
  }

  /**
   * Gets a single service by ID, scoped to tenant.
   *
   * Requirement: 30.2
   */
  async findOne(tenantId: string, id: string): Promise<ServiceDTO> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, outlet_id, name, category, business_unit, price, is_active, is_main_service, sort_order, category_id, brand_id, outlet_ids, barcode, dynamic_discount_enabled, dynamic_discount_kind, max_discount
       FROM services
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Service with id ${id} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Updates an existing service.
   *
   * Requirements: 30.2, 30.3
   */
  async update(
    tenantId: string,
    id: string,
    dto: Partial<CreateServiceRequest>,
  ): Promise<ServiceDTO> {
    if (dto.category) {
      this.validateCategory(dto.category);
    }
    if (dto.businessUnit) {
      this.validateBusinessUnit(dto.businessUnit);
    }
    this.validateDynamicDiscount(dto.dynamicDiscountEnabled, dto.dynamicDiscountKind, dto.maxDiscount);

    // Verify exists first
    await this.findOne(tenantId, id);

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (dto.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      values.push(dto.name);
      paramIndex++;
    }

    if (dto.category !== undefined) {
      setClauses.push(`category = $${paramIndex}`);
      values.push(dto.category);
      paramIndex++;
    }

    if (dto.businessUnit !== undefined) {
      setClauses.push(`business_unit = $${paramIndex}`);
      values.push(dto.businessUnit);
      paramIndex++;
    }

    if (dto.price !== undefined) {
      setClauses.push(`price = $${paramIndex}`);
      values.push(dto.price);
      paramIndex++;
    }

    if (dto.outletId !== undefined) {
      setClauses.push(`outlet_id = $${paramIndex}`);
      values.push(dto.outletId);
      paramIndex++;
    }

    if (dto.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex}`);
      values.push(dto.isActive);
      paramIndex++;
    }

    if (dto.isMainService !== undefined) {
      setClauses.push(`is_main_service = $${paramIndex}`);
      values.push(dto.isMainService);
      paramIndex++;
    }

    if (dto.sortOrder !== undefined) {
      setClauses.push(`sort_order = $${paramIndex}`);
      values.push(dto.sortOrder);
      paramIndex++;
    }

    if (dto.categoryId !== undefined) {
      setClauses.push(`category_id = $${paramIndex}`);
      values.push(dto.categoryId);
      paramIndex++;
    }

    if (dto.brandId !== undefined) {
      setClauses.push(`brand_id = $${paramIndex}`);
      values.push(dto.brandId);
      paramIndex++;
    }

    if (dto.outletIds !== undefined) {
      setClauses.push(`outlet_ids = $${paramIndex}`);
      values.push(dto.outletIds && dto.outletIds.length > 0 ? dto.outletIds : null);
      paramIndex++;
    }

    if (dto.barcode !== undefined) {
      setClauses.push(`barcode = $${paramIndex}`);
      values.push(this.cleanBarcode(dto.barcode));
      paramIndex++;
    }

    if (dto.dynamicDiscountEnabled !== undefined) {
      setClauses.push(`dynamic_discount_enabled = $${paramIndex}`);
      values.push(dto.dynamicDiscountEnabled);
      paramIndex++;
    }

    if (dto.dynamicDiscountKind !== undefined) {
      setClauses.push(`dynamic_discount_kind = $${paramIndex}`);
      values.push(dto.dynamicDiscountKind);
      paramIndex++;
    }

    if (dto.maxDiscount !== undefined) {
      setClauses.push(`max_discount = $${paramIndex}`);
      values.push(dto.maxDiscount);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return this.findOne(tenantId, id);
    }

    setClauses.push(`updated_at = NOW()`);

    let result;
    try {
      result = await this.pool.query(
        `UPDATE services
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
         RETURNING id, tenant_id, outlet_id, name, category, business_unit, price, is_active, is_main_service, sort_order, category_id, brand_id, outlet_ids, barcode, dynamic_discount_enabled, dynamic_discount_kind, max_discount`,
        [...values, id, tenantId],
      );
    } catch (err) {
      throw this.mapBarcodeError(err);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Soft-deletes a service by setting is_active = false.
   * Inactive services show as "Habis" (disabled) in POS.
   *
   * Requirements: 30.4
   */
  async remove(tenantId: string, id: string): Promise<void> {
    // Verify exists first
    await this.findOne(tenantId, id);

    await this.pool.query(
      `UPDATE services SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
  }

  /**
   * Batch update sort_order for multiple services within a category.
   * Allows reordering within categories.
   *
   * Requirement: 30.3
   */
  async reorder(tenantId: string, items: ReorderItem[]): Promise<void> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Reorder items cannot be empty');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        await client.query(
          `UPDATE services SET sort_order = $1, updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3`,
          [item.sortOrder, item.id, tenantId],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private validateCategory(category: string): void {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new BadRequestException(
        `Invalid category: ${category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      );
    }
  }

  private validateBusinessUnit(businessUnit: string): void {
    if (!VALID_BUSINESS_UNITS.includes(businessUnit)) {
      throw new BadRequestException(
        `Invalid business unit: ${businessUnit}. Must be one of: ${VALID_BUSINESS_UNITS.join(', ')}`,
      );
    }
  }

  /**
   * Mirrors the services_dynamic_discount_coherent_check DB constraint
   * (migration 085) server-side, so a bad request 400s with a clear message
   * instead of surfacing as an opaque Postgres constraint-violation 500.
   * Fields are undefined when the caller isn't touching them (partial update).
   */
  private validateDynamicDiscount(
    enabled: boolean | undefined,
    kind: 'fixed' | 'percentage' | null | undefined,
    maxDiscount: number | null | undefined,
  ): void {
    if (enabled && !kind) {
      throw new BadRequestException('dynamicDiscountKind is required when dynamicDiscountEnabled is true');
    }

    if (enabled && (maxDiscount === undefined || maxDiscount === null)) {
      throw new BadRequestException('maxDiscount is required when dynamicDiscountEnabled is true');
    }

    if (maxDiscount !== undefined && maxDiscount !== null) {
      if (maxDiscount <= 0) {
        throw new BadRequestException('maxDiscount must be greater than 0');
      }
      if (kind === 'percentage' && maxDiscount > 100) {
        throw new BadRequestException('maxDiscount cannot exceed 100 when dynamicDiscountKind is percentage');
      }
    }
  }

  private mapRow(row: any): ServiceDTO {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      outletId: row.outlet_id ?? null,
      name: row.name,
      category: row.category as ServiceCategory,
      businessUnit: (row.business_unit ?? BusinessUnit.Aire) as BusinessUnit,
      categoryId: row.category_id ?? null,
      brandId: row.brand_id ?? null,
      outletIds: row.outlet_ids ?? null,
      price: parseFloat(row.price),
      isActive: row.is_active,
      isMainService: row.is_main_service,
      sortOrder: row.sort_order,
      barcode: row.barcode ?? null,
      dynamicDiscountEnabled: row.dynamic_discount_enabled ?? false,
      dynamicDiscountKind: row.dynamic_discount_kind ?? null,
      maxDiscount: row.max_discount != null ? parseFloat(row.max_discount) : null,
    };
  }
}
