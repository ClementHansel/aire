-- 041_platform_plans.sql
-- SaaS subscription plans that the PLATFORM charges each tenant. This is
-- distinct from `membership_plans` (which a tenant sells to its own customers).
-- A tenant's current plan is the existing `tenants.plan` string, matched to
-- `platform_plans.code`. Billing/MRR reads prices from here.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(64) UNIQUE NOT NULL,        -- matches tenants.plan
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  price         DECIMAL(12,2) NOT NULL DEFAULT 0,   -- price per billing cycle (IDR)
  billing_cycle VARCHAR(16) NOT NULL DEFAULT 'monthly'
                CHECK (billing_cycle IN ('monthly','annual')),
  features      JSONB NOT NULL DEFAULT '[]',         -- string[] of feature labels
  limits        JSONB NOT NULL DEFAULT '{}',         -- { outlets?, users?, ... }
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the three default plan codes (matching the historical
-- platform_config.pricingTiers / tenants.plan values) so Billing keeps working.
-- Prices left at 0 for the super-admin to fill in. Idempotent: only on empty table.
INSERT INTO platform_plans (code, name, price, billing_cycle, sort_order)
SELECT v.code, v.name, v.price, v.cycle, v.ord
FROM (VALUES
  ('standard',   'Standard',   0::numeric, 'monthly', 1),
  ('premium',    'Premium',    0::numeric, 'monthly', 2),
  ('enterprise', 'Enterprise', 0::numeric, 'monthly', 3)
) AS v(code, name, price, cycle, ord)
WHERE NOT EXISTS (SELECT 1 FROM platform_plans);

COMMIT;
