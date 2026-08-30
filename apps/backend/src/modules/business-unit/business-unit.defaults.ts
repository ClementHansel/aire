import { Pool } from 'pg';

/**
 * The units a brand-new tenant starts with (AIRIN-176).
 *
 * Migration 096 seeds these for tenants that already existed. A tenant created
 * AFTER that migration gets them here — without this a new tenant would have an
 * EMPTY unit list, which is not merely cosmetic: `BusinessUnitService.assertValid`
 * would reject every service they tried to create, and the POS would render a
 * catalog with no tabs.
 *
 * Kept as a seed rather than a hard default so a tenant can rename or retire
 * them afterwards, which is the entire point of the ticket.
 */
export const DEFAULT_BUSINESS_UNITS: {
  code: string; name: string; color: string; sortOrder: number;
}[] = [
  { code: 'AIRE', name: 'AIRE', color: '#0ea5e9', sortOrder: 0 },
  { code: 'LEAD', name: 'LEAD', color: '#8b5cf6', sortOrder: 1 },
];

/** Idempotent: does nothing if the tenant already has any unit. */
export async function seedDefaultBusinessUnits(pool: Pool, tenantId: string): Promise<number> {
  const existing = await pool.query('SELECT 1 FROM business_units WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  if ((existing.rowCount ?? 0) > 0) return 0;

  let inserted = 0;
  for (const u of DEFAULT_BUSINESS_UNITS) {
    await pool.query(
      `INSERT INTO business_units (tenant_id, code, name, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, u.code, u.name, u.color, u.sortOrder],
    );
    inserted++;
  }
  return inserted;
}
