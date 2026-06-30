-- 019_platform_config.sql
-- Platform-wide configuration singleton used by the Platform Admin area
-- (default plans, pricing tiers, feature flags). The admin config + billing
-- pages were returning 500 because this table did not exist.
-- Not tenant-scoped, so no RLS policy is applied.

CREATE TABLE IF NOT EXISTS platform_config (
  id         TEXT PRIMARY KEY,
  config     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO platform_config (id, config)
VALUES (
  'default',
  '{"defaultPlans":["standard","premium","enterprise"],"pricingTiers":[],"featureFlags":{}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
