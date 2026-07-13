import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface VehicleBrandDTO { id: string; name: string; types: { id: string; name: string }[] }

/** Vehicle brand + type catalog (per tenant) that powers POS brand→type dropdowns. */
@Injectable()
export class VehicleCatalogService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async listBrandsWithTypes(tenantId: string): Promise<VehicleBrandDTO[]> {
    const brands = await this.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM vehicle_brands WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order, name`,
      [tenantId],
    );
    const types = await this.pool.query<{ id: string; brand_id: string; name: string }>(
      `SELECT id, brand_id, name FROM vehicle_types WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order, name`,
      [tenantId],
    );
    return brands.rows.map((b) => ({
      id: b.id,
      name: b.name,
      types: types.rows.filter((t) => t.brand_id === b.id).map((t) => ({ id: t.id, name: t.name })),
    }));
  }

  async createBrand(tenantId: string, name: string): Promise<{ id: string; name: string }> {
    if (!name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query<{ id: string; name: string }>(
      `INSERT INTO vehicle_brands (tenant_id, name) VALUES ($1, $2)
       ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true
       RETURNING id, name`,
      [tenantId, name.trim()],
    );
    return res.rows[0]!;
  }

  async deleteBrand(tenantId: string, id: string): Promise<void> {
    await this.pool.query(`UPDATE vehicle_brands SET is_active = false WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }

  async createType(tenantId: string, brandId: string, name: string): Promise<{ id: string; name: string }> {
    if (!name?.trim()) throw new BadRequestException('name is required');
    const brand = await this.pool.query(`SELECT 1 FROM vehicle_brands WHERE id = $1 AND tenant_id = $2`, [brandId, tenantId]);
    if (brand.rows.length === 0) throw new NotFoundException('Brand not found');
    const res = await this.pool.query<{ id: string; name: string }>(
      `INSERT INTO vehicle_types (tenant_id, brand_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (brand_id, name) DO UPDATE SET is_active = true
       RETURNING id, name`,
      [tenantId, brandId, name.trim()],
    );
    return res.rows[0]!;
  }

  async deleteType(tenantId: string, id: string): Promise<void> {
    await this.pool.query(`UPDATE vehicle_types SET is_active = false WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }
}
