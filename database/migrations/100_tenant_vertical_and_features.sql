-- Migration: 100_tenant_vertical_and_features
-- Description: A tenant declares which line of business it runs, so the app can
--              stop assuming every customer arrives in a car.
--
--   Until now the platform had exactly one shape: a car wash. Plate, brand and
--   model were captured on every order, the queue board was a *vehicle* queue,
--   and memberships were activated against license plates. That is correct for
--   the founding tenant (Airin, running AIRE wash + LEAD detailing) and wrong
--   for every other kind of business we are about to onboard — a lab-services
--   company has no plates to type, and the POS refuses to take an order without
--   one.
--
--   `vertical` is the tenant's module in the Airin Platform sense: which product
--   they bought. It resolves to a CAPABILITY PRESET in application code
--   (tenant-features.ts) rather than to a second set of columns here, so adding
--   a vertical later is a code change, not a migration.
--
--   `settings.features` is the per-tenant override layer on top of that preset,
--   mirroring how `settings.entitlementOverrides` already overrides plan limits.
--   An absent key means "inherit the preset" — only an explicit true/false wins.
--
--   Existing tenants are backfilled to 'carwash', which is exactly what they are,
--   so this migration changes NO current behaviour.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vertical VARCHAR(32) NOT NULL DEFAULT 'carwash';

COMMENT ON COLUMN tenants.vertical IS
  'Line of business / Airin Platform module: carwash | services | fnb | laundry. '
  'Resolves to a capability preset in apps/backend/src/common/tenant-features.ts. '
  'Override individual capabilities via settings.features.';

-- Guard against typos reaching the column; extend the list when a vertical ships.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_vertical_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_vertical_check
  CHECK (vertical IN ('carwash', 'services', 'fnb', 'laundry'));

-- Every tenant that exists today IS a car wash. Explicit rather than relying on
-- the column default, so the intent survives a future default change.
UPDATE tenants SET vertical = 'carwash' WHERE vertical IS NULL OR vertical = '';

CREATE INDEX IF NOT EXISTS idx_tenants_vertical ON tenants(vertical);

COMMIT;
