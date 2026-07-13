-- Migration: 037_membership_renewals
-- Description: Track a pending membership renewal against its fee order so the
--   extension is applied ONLY after the order is confirmed paid (not before).
-- Created at: 2026-07-10

BEGIN;

CREATE TABLE IF NOT EXISTS membership_renewals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_membership_renewals_order ON membership_renewals(order_id);

COMMIT;
