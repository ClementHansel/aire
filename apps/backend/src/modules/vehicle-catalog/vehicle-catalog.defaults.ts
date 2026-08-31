import { Pool } from 'pg';

/**
 * Give a brand-new tenant the starter vehicle catalog.
 *
 * Migrations 035/036 seeded vehicle_brands/vehicle_types straight from the
 * `tenants` table, which back-filled everyone who existed on 2026-07-10 and
 * nobody since — provisioning never seeded the catalog. Every tenant created
 * after that opened the Vehicle Catalog page and the POS brand/model pickers to
 * find them empty, which reads to an owner as "our data disappeared".
 *
 * The list itself lives in `vehicle_catalog_defaults` (migration 097) rather
 * than in this file, so the back-fill and this seed cannot drift apart and a
 * new brand can be added in one place.
 *
 * Idempotent, and deliberately a no-op if the tenant already has ANY brand —
 * a tenant who pruned the list down to what they actually wash must not have it
 * grow back underneath them.
 */
export async function seedDefaultVehicleCatalog(pool: Pool, tenantId: string): Promise<number> {
  const existing = await pool.query('SELECT 1 FROM vehicle_brands WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  if ((existing.rowCount ?? 0) > 0) return 0;

  const brands = await pool.query(
    `INSERT INTO vehicle_brands (tenant_id, name, sort_order)
     SELECT $1, d.brand, MIN(d.brand_order)
     FROM vehicle_catalog_defaults d
     GROUP BY d.brand
     ON CONFLICT (tenant_id, name) DO NOTHING`,
    [tenantId],
  );

  await pool.query(
    `INSERT INTO vehicle_types (tenant_id, brand_id, name, sort_order)
     SELECT vb.tenant_id, vb.id, d.model, d.model_order
     FROM vehicle_brands vb
     JOIN vehicle_catalog_defaults d ON d.brand = vb.name
     WHERE vb.tenant_id = $1
       AND NOT EXISTS (SELECT 1 FROM vehicle_types vt WHERE vt.brand_id = vb.id)
     ON CONFLICT (brand_id, name) DO NOTHING`,
    [tenantId],
  );

  return brands.rowCount ?? 0;
}
