-- Migration: 052_tenant_onboarding
-- Description: Tenant onboarding state. `onboarding_completed_at` is the gate flag
--   (NULL = the tenant owner must still finish the setup wizard before the app
--   unlocks for daily operations). `onboarding_state` holds the wizard's progress
--   (current step, skipped optional steps, who pre-filled). Step *completion* is
--   derived from real data (legal entity / branch / service counts), not stored here.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_state JSONB NOT NULL DEFAULT '{}';

-- Backfill: every EXISTING tenant is already operating, so mark them complete —
-- the gate must never lock out a tenant that predates onboarding.
UPDATE tenants SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW());

COMMIT;
