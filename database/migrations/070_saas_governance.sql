-- 070_saas_governance.sql
-- SaaS control-plane governance: make tenant lifecycle + plan entitlements real.
--   1. tenants.status gains 'past_due' (the dunning state between active and
--      suspended) + reason/timestamp columns so a status change is explainable.
--   2. tenant_status_events — an append-only history of every status transition
--      (who, why, from→to, source). This is what turns the Growth analytics from
--      snapshot guesses into truthful churn/retention numbers.
--   3. Seed sensible default plan limits so the entitlement engine has teeth
--      (only where a plan currently has no limits — never overwrites admin edits).

BEGIN;

-- ── 1. Tenant lifecycle columns + widened status domain ─────────────────────
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('active', 'past_due', 'suspended', 'cancelled'));

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Append-only status history ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_status_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_status   VARCHAR(20),
  to_status     VARCHAR(20) NOT NULL,
  reason        TEXT,
  -- who/what drove the change: an admin action, the billing job, or the system
  source        VARCHAR(16) NOT NULL DEFAULT 'admin'
                CHECK (source IN ('admin', 'billing', 'system')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_status_events_tenant ON tenant_status_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_status_events_to ON tenant_status_events(to_status, created_at DESC);

-- Backfill one baseline event per existing tenant so history is never empty.
INSERT INTO tenant_status_events (tenant_id, from_status, to_status, reason, source, created_at)
SELECT id, NULL, status, 'baseline (migration 070)', 'system', COALESCE(created_at, NOW())
FROM tenants
WHERE NOT EXISTS (SELECT 1 FROM tenant_status_events e WHERE e.tenant_id = tenants.id);

-- ── 3. Default plan limits (only when a plan has none) ───────────────────────
-- Engine treats a missing key or a value <= 0 as UNLIMITED. Enterprise stays
-- unlimited on purpose. These are conservative starters; admins edit them in the
-- Subscription Plans UI.
UPDATE platform_plans SET limits = '{"outlets": 1, "users": 5}'::jsonb
  WHERE code = 'standard'   AND (limits IS NULL OR limits = '{}'::jsonb);
UPDATE platform_plans SET limits = '{"outlets": 5, "users": 25}'::jsonb
  WHERE code = 'premium'    AND (limits IS NULL OR limits = '{}'::jsonb);
UPDATE platform_plans SET limits = '{}'::jsonb
  WHERE code = 'enterprise' AND limits IS NULL;

COMMIT;
