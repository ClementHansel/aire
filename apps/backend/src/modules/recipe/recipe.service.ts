import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export interface RecipeComponentInput { inventoryItemId: string; quantity: number; unit: string }
export interface CostComponentInput { componentTypeId: string; value: number }
export interface SetRecipeDto { components: RecipeComponentInput[]; costComponents: CostComponentInput[] }

/**
 * Product recipes (BOM) + non-physical cost components + per-item UOM conversions.
 * A "product" is a `services` row. Used by the COGS auto-deduction on sale.
 */
@Injectable()
export class RecipeService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private async assertService(tenantId: string, serviceId: string): Promise<void> {
    const r = await this.pool.query(`SELECT 1 FROM services WHERE id = $1 AND tenant_id = $2`, [serviceId, tenantId]);
    if (r.rows.length === 0) throw new BadRequestException('Service not found');
  }

  async getRecipe(tenantId: string, serviceId: string) {
    await this.assertService(tenantId, serviceId);
    const comps = await this.pool.query(
      `SELECT rc.id, rc.inventory_item_id, ii.name AS item_name, ii.unit AS item_unit,
              ii.quantity AS item_stock, ii.unit_cost, rc.quantity, rc.unit
       FROM service_recipe_components rc
       JOIN inventory_items ii ON ii.id = rc.inventory_item_id
       WHERE rc.service_id = $1 AND rc.tenant_id = $2
       ORDER BY ii.name`,
      [serviceId, tenantId],
    );
    const costs = await this.pool.query(
      `SELECT scc.id, scc.component_type_id, ct.name, ct.kind, scc.value
       FROM service_cost_components scc
       JOIN cost_component_types ct ON ct.id = scc.component_type_id
       WHERE scc.service_id = $1 AND scc.tenant_id = $2
       ORDER BY ct.name`,
      [serviceId, tenantId],
    );
    return {
      components: comps.rows.map((r: any) => ({
        id: r.id, inventoryItemId: r.inventory_item_id, itemName: r.item_name, itemUnit: r.item_unit,
        itemStock: parseFloat(r.item_stock), unitCost: parseFloat(r.unit_cost),
        quantity: parseFloat(r.quantity), unit: r.unit,
      })),
      costComponents: costs.rows.map((r: any) => ({
        id: r.id, componentTypeId: r.component_type_id, name: r.name, kind: r.kind, value: parseFloat(r.value),
      })),
    };
  }

  /** Replace a service's whole recipe (physical components + cost components). */
  async setRecipe(tenantId: string, serviceId: string, dto: SetRecipeDto): Promise<void> {
    await this.assertService(tenantId, serviceId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM service_recipe_components WHERE service_id = $1 AND tenant_id = $2`, [serviceId, tenantId]);
      for (const c of dto.components ?? []) {
        if (!c.inventoryItemId || !(c.quantity > 0)) continue;
        await client.query(
          `INSERT INTO service_recipe_components (tenant_id, service_id, inventory_item_id, quantity, unit)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, serviceId, c.inventoryItemId, c.quantity, c.unit || 'pcs'],
        );
      }
      await client.query(`DELETE FROM service_cost_components WHERE service_id = $1 AND tenant_id = $2`, [serviceId, tenantId]);
      for (const cc of dto.costComponents ?? []) {
        if (!cc.componentTypeId) continue;
        await client.query(
          `INSERT INTO service_cost_components (tenant_id, service_id, component_type_id, value)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, serviceId, cc.componentTypeId, cc.value ?? 0],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Cost component types (reusable per-tenant list) ───────────────────────
  async listCostTypes(tenantId: string) {
    const r = await this.pool.query(
      `SELECT id, name, kind, is_active FROM cost_component_types WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
      [tenantId],
    );
    return r.rows.map((x: any) => ({ id: x.id, name: x.name, kind: x.kind, isActive: x.is_active }));
  }
  async createCostType(tenantId: string, name: string, kind: 'fixed' | 'percentage') {
    if (!name?.trim()) throw new BadRequestException('name is required');
    const r = await this.pool.query(
      `INSERT INTO cost_component_types (tenant_id, name, kind) VALUES ($1, $2, $3) RETURNING id, name, kind, is_active`,
      [tenantId, name.trim(), kind === 'percentage' ? 'percentage' : 'fixed'],
    );
    const x = r.rows[0];
    return { id: x.id, name: x.name, kind: x.kind, isActive: x.is_active };
  }
  async deleteCostType(tenantId: string, id: string): Promise<void> {
    await this.pool.query(`UPDATE cost_component_types SET is_active = false WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }

  // ── UOM conversions per inventory item ────────────────────────────────────
  async listUom(tenantId: string, itemId: string) {
    const r = await this.pool.query(
      `SELECT id, from_unit, to_unit, factor FROM uom_conversions WHERE tenant_id = $1 AND inventory_item_id = $2 ORDER BY from_unit`,
      [tenantId, itemId],
    );
    return r.rows.map((x: any) => ({ id: x.id, fromUnit: x.from_unit, toUnit: x.to_unit, factor: parseFloat(x.factor) }));
  }
  async createUom(tenantId: string, itemId: string, fromUnit: string, toUnit: string, factor: number) {
    if (!fromUnit || !toUnit || !(factor > 0)) throw new BadRequestException('fromUnit, toUnit and a positive factor are required');
    const r = await this.pool.query(
      `INSERT INTO uom_conversions (tenant_id, inventory_item_id, from_unit, to_unit, factor)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (inventory_item_id, from_unit, to_unit) DO UPDATE SET factor = EXCLUDED.factor
       RETURNING id, from_unit, to_unit, factor`,
      [tenantId, itemId, fromUnit, toUnit, factor],
    );
    const x = r.rows[0];
    return { id: x.id, fromUnit: x.from_unit, toUnit: x.to_unit, factor: parseFloat(x.factor) };
  }
  async deleteUom(tenantId: string, id: string): Promise<void> {
    await this.pool.query(`DELETE FROM uom_conversions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  }
}
