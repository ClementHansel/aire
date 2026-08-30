-- Migration: 096_business_units
-- Description: Business units become tenant-owned records instead of a
--              two-value CHECK constraint (AIRIN-176).
--
--   Until now "AIRE" and "LEAD" were literals baked into a CHECK on four
--   tables. A tenant could not add a third line of business, and a tenant who
--   is not AIRE read someone else's brand names in their own dashboard.
--
--   Shape of the fix:
--     * `business_units` — one row per (tenant, code). Code stays a SHORT
--       UPPERCASE string because it is what the existing `business_unit`
--       columns already store; nothing has to be rewritten or backfilled to a
--       new id, which is why this migration is additive rather than a rename.
--     * The four CHECKs are DROPPED. They are replaced by application-level
--       validation against this table, not by a FK: `orders` and
--       `vehicle_queue` hold historical rows whose unit may since have been
--       deleted, and a FK would either block that delete or force a cascade
--       that rewrites finished orders. Referential rules that must not touch
--       history belong in the service, which refuses to delete a unit still in
--       use rather than mutating what already happened.
--     * Seeding takes the union of the built-in pair AND every distinct value
--       already present in the four columns, so a tenant carrying an unexpected
--       code keeps working instead of having it vanish from their filters.
-- Created at: 2026-08-30

BEGIN;

CREATE TABLE IF NOT EXISTS business_units (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code       VARCHAR(10)  NOT NULL CHECK (btrim(code) <> ''),
  name       VARCHAR(80)  NOT NULL CHECK (btrim(name) <> ''),
  color      VARCHAR(9)   NOT NULL DEFAULT '#1652F0',
  sort_order INTEGER      NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_business_units_tenant
  ON business_units(tenant_id, sort_order, code);

COMMENT ON TABLE business_units IS
  'Tenant-owned lines of business. `code` is what the business_unit columns on services/orders/payment_methods/vehicle_queue store. AIRIN-176.';

-- ── Seed: the built-in pair, plus anything already in use ───────────────────

INSERT INTO business_units (tenant_id, code, name, color, sort_order)
SELECT t.id, v.code, v.name, v.color, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('AIRE', 'AIRE',  '#0ea5e9', 0),
  ('LEAD', 'LEAD',  '#8b5cf6', 1)
) AS v(code, name, color, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Any code a tenant actually has rows for but that is not in the pair above.
INSERT INTO business_units (tenant_id, code, name, color, sort_order)
SELECT DISTINCT u.tenant_id, u.business_unit, u.business_unit, '#64748b', 90
FROM (
  SELECT tenant_id, business_unit FROM services        WHERE business_unit IS NOT NULL
  UNION SELECT tenant_id, business_unit FROM orders          WHERE business_unit IS NOT NULL
  UNION SELECT tenant_id, business_unit FROM payment_methods WHERE business_unit IS NOT NULL
  UNION SELECT tenant_id, business_unit FROM vehicle_queue   WHERE business_unit IS NOT NULL
) AS u
WHERE u.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── Retire the CHECKs the table now replaces ────────────────────────────────

ALTER TABLE services        DROP CONSTRAINT IF EXISTS services_business_unit_check;
ALTER TABLE orders          DROP CONSTRAINT IF EXISTS orders_business_unit_check;
ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_business_unit_check;
ALTER TABLE vehicle_queue   DROP CONSTRAINT IF EXISTS vehicle_queue_business_unit_check;

ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_business_units ON business_units;
CREATE POLICY tenant_isolation_business_units ON business_units
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

DROP TRIGGER IF EXISTS set_updated_at_business_units ON business_units;
CREATE TRIGGER set_updated_at_business_units
  BEFORE UPDATE ON business_units
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;
