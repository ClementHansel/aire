import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type AppliesTo = 'service' | 'product' | 'both';
const APPLIES_TO: AppliesTo[] = ['service', 'product', 'both'];

export interface CategoryRecord {
  id: string; tenantId: string; name: string; sortOrder: number; isActive: boolean; appliesTo: AppliesTo;
}
/**
 * The service TYPE codes. Fixed on purpose (AIRIN-175): `car_wash` is what the
 * POS cart rule "a cart needs a main service" keys off, `product` is what
 * splits the Services page from the Products page, and every report groups by
 * these. A tenant may rename them; a tenant may not invent a fourth, because
 * nothing downstream would know how to treat it.
 */
export const SERVICE_TYPE_CODES = ['car_wash', 'add_on', 'product'] as const;
export type ServiceTypeCode = (typeof SERVICE_TYPE_CODES)[number];

/** Built-in wording, used when a tenant has not renamed a type. */
export const DEFAULT_SERVICE_TYPE_LABELS: Record<ServiceTypeCode, string> = {
  car_wash: 'Car Wash',
  add_on: 'Add-on',
  product: 'Product',
};

export interface ServiceTypeLabel {
  code: ServiceTypeCode;
  /** What this tenant calls the type — their override, or the built-in default. */
  label: string;
  /** false when `label` is the built-in default rather than a tenant's own wording. */
  customized: boolean;
}

export interface BrandRecord {
  id: string; tenantId: string; code: string; name: string; color: string; isActive: boolean; appliesTo: AppliesTo;
}

/**
 * Product categories + brands. A product (service) must reference a category and
 * a brand; these are tenant-scoped and CRUD-able from the dashboard.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ── Categories ──────────────────────────────────────────────────────────────
  async listCategories(tenantId: string): Promise<CategoryRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM product_categories WHERE tenant_id = $1 ORDER BY sort_order, name',
      [tenantId],
    );
    return res.rows.map(this.mapCategory);
  }

  async createCategory(tenantId: string, name: string, sortOrder = 0, appliesTo: AppliesTo = 'both'): Promise<CategoryRecord> {
    if (!name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query(
      `INSERT INTO product_categories (tenant_id, name, sort_order, applies_to) VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, name.trim(), sortOrder, this.normAppliesTo(appliesTo)],
    );
    return this.mapCategory(res.rows[0]);
  }

  async updateCategory(tenantId: string, id: string, patch: { name?: string; sortOrder?: number; isActive?: boolean; appliesTo?: AppliesTo }): Promise<CategoryRecord> {
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.name !== undefined) { set.push(`name = $${i++}`); v.push(patch.name); }
    if (patch.sortOrder !== undefined) { set.push(`sort_order = $${i++}`); v.push(patch.sortOrder); }
    if (patch.isActive !== undefined) { set.push(`is_active = $${i++}`); v.push(patch.isActive); }
    if (patch.appliesTo !== undefined) { set.push(`applies_to = $${i++}`); v.push(this.normAppliesTo(patch.appliesTo)); }
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()'); v.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE product_categories SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`, v,
    );
    if (res.rows.length === 0) throw new NotFoundException('Category not found');
    return this.mapCategory(res.rows[0]);
  }

  async removeCategory(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query('DELETE FROM product_categories WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Category not found');
  }

  // ── Brands ──────────────────────────────────────────────────────────────────
  async listBrands(tenantId: string): Promise<BrandRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM brands WHERE tenant_id = $1 ORDER BY name',
      [tenantId],
    );
    return res.rows.map(this.mapBrand);
  }

  async createBrand(tenantId: string, dto: { code: string; name: string; color?: string; appliesTo?: AppliesTo }): Promise<BrandRecord> {
    if (!dto.code?.trim() || !dto.name?.trim()) throw new BadRequestException('code and name are required');
    const res = await this.pool.query(
      `INSERT INTO brands (tenant_id, code, name, color, applies_to) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, dto.code.trim().toUpperCase(), dto.name.trim(), dto.color ?? '#1652F0', this.normAppliesTo(dto.appliesTo)],
    );
    return this.mapBrand(res.rows[0]);
  }

  async updateBrand(tenantId: string, id: string, patch: { name?: string; color?: string; isActive?: boolean; appliesTo?: AppliesTo }): Promise<BrandRecord> {
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.name !== undefined) { set.push(`name = $${i++}`); v.push(patch.name); }
    if (patch.color !== undefined) { set.push(`color = $${i++}`); v.push(patch.color); }
    if (patch.isActive !== undefined) { set.push(`is_active = $${i++}`); v.push(patch.isActive); }
    if (patch.appliesTo !== undefined) { set.push(`applies_to = $${i++}`); v.push(this.normAppliesTo(patch.appliesTo)); }
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()'); v.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE brands SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`, v,
    );
    if (res.rows.length === 0) throw new NotFoundException('Brand not found');
    return this.mapBrand(res.rows[0]);
  }

  async removeBrand(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query('DELETE FROM brands WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Brand not found');
  }

  // ── Service type labels (AIRIN-175) ──────────────────────────────────

  /**
   * Every type code with the wording this tenant reads. Always returns all three
   * codes, so a caller can render a dropdown straight from this without merging
   * in defaults itself — a tenant with no rows gets the built-in labels.
   */
  async listServiceTypeLabels(tenantId: string): Promise<ServiceTypeLabel[]> {
    const res = await this.pool.query<{ code: string; label: string }>(
      'SELECT code, label FROM service_type_labels WHERE tenant_id = $1',
      [tenantId],
    );
    const overrides = new Map(res.rows.map((r) => [r.code, r.label] as const));
    return SERVICE_TYPE_CODES.map((code) => ({
      code,
      label: overrides.get(code) ?? DEFAULT_SERVICE_TYPE_LABELS[code],
      customized: overrides.has(code),
    }));
  }

  /**
   * Rename one or more types. A label equal to the built-in default (or blank)
   * DELETES the override rather than storing it, so "reset to default" needs no
   * separate endpoint and the table only ever holds real customizations.
   */
  async saveServiceTypeLabels(
    tenantId: string,
    labels: Partial<Record<ServiceTypeCode, string>>,
  ): Promise<ServiceTypeLabel[]> {
    const entries = Object.entries(labels) as [string, unknown][];
    if (entries.length === 0) throw new BadRequestException('No labels to update');

    for (const [code, raw] of entries) {
      if (!SERVICE_TYPE_CODES.includes(code as ServiceTypeCode)) {
        throw new BadRequestException(`Unknown service type: ${code}`);
      }
      const label = typeof raw === 'string' ? raw.trim() : '';
      if (label.length > 60) throw new BadRequestException('Label must be 60 characters or fewer');

      if (label === '' || label === DEFAULT_SERVICE_TYPE_LABELS[code as ServiceTypeCode]) {
        await this.pool.query(
          'DELETE FROM service_type_labels WHERE tenant_id = $1 AND code = $2',
          [tenantId, code],
        );
        continue;
      }
      await this.pool.query(
        `INSERT INTO service_type_labels (tenant_id, code, label) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, code) DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()`,
        [tenantId, code, label],
      );
    }
    return this.listServiceTypeLabels(tenantId);
  }

  private normAppliesTo(value: AppliesTo | undefined): AppliesTo {
    return value && APPLIES_TO.includes(value) ? value : 'both';
  }

  private mapCategory = (r: any): CategoryRecord => ({
    id: r.id, tenantId: r.tenant_id, name: r.name, sortOrder: r.sort_order ?? 0, isActive: r.is_active, appliesTo: r.applies_to ?? 'both',
  });
  private mapBrand = (r: any): BrandRecord => ({
    id: r.id, tenantId: r.tenant_id, code: r.code, name: r.name, color: r.color ?? '#1652F0', isActive: r.is_active, appliesTo: r.applies_to ?? 'both',
  });
}
