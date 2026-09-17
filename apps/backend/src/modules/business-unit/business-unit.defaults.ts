import { Pool } from 'pg';
import {
  DEFAULT_BUSINESS_UNITS_BY_VERTICAL,
  TenantVertical,
  asVertical,
} from '@aire/shared';

/**
 * The units a brand-new tenant starts with (AIRIN-176).
 *
 * Migration 096 seeds these for tenants that already existed. A tenant created
 * AFTER that migration gets them here — without this a new tenant would have an
 * EMPTY unit list, which is not merely cosmetic: `BusinessUnitService.assertValid`
 * would reject every service they tried to create, and the POS would render a
 * catalog with no tabs.
 *
 * The starter set is chosen by the tenant's VERTICAL, not hardcoded. It used to
 * be a literal AIRE/LEAD pair — the founding tenant's two brand names — which
 * meant every other company we onboarded was seeded with someone else's brands
 * and could only rename them after the fact. The founding tenant is unaffected:
 * this seed is idempotent and skips any tenant that already has units.
 *
 * Kept as a seed rather than a hard default so a tenant can rename or retire
 * them afterwards, which is the entire point of the ticket.
 */
export function defaultBusinessUnitsFor(vertical: TenantVertical) {
  return DEFAULT_BUSINESS_UNITS_BY_VERTICAL[vertical].map((u: { code: string; name: string; color: string }, i: number) => ({ ...u, sortOrder: i }));
}

/**
 * Idempotent: does nothing if the tenant already has any unit.
 *
 * `vertical` is read from the tenant row when not supplied, so callers that
 * already know it (tenant creation) can skip the lookup.
 */
export async function seedDefaultBusinessUnits(
  pool: Pool,
  tenantId: string,
  vertical?: TenantVertical,
): Promise<number> {
  const existing = await pool.query('SELECT 1 FROM business_units WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  if ((existing.rowCount ?? 0) > 0) return 0;

  let v = vertical;
  if (!v) {
    const row = await pool
      .query<{ vertical: string | null }>('SELECT vertical FROM tenants WHERE id = $1', [tenantId])
      .catch(() => ({ rows: [] as { vertical: string | null }[] }));
    v = asVertical(row.rows[0]?.vertical);
  }

  let inserted = 0;
  for (const u of defaultBusinessUnitsFor(v)) {
    await pool.query(
      `INSERT INTO business_units (tenant_id, code, name, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, u.code, u.name, u.color, u.sortOrder],
    );
    inserted++;
  }
  return inserted;
}
