-- Migration: 031_membership_lifecycle
-- Description: Adds the Active → Grace → Revoked lifecycle and an event history.
--   * grace   = paid period ended, within H+1..H+14 (renewable, but no benefits)
--   * revoked = past H+14 (terminal; a new membership must be created)
--   'suspended' (027) stays as a distinct MANUAL admin block, independent of dates.
--   Canonical status is enforced two ways: a daily transition job writes these
--   values, and read/benefit paths validate end_date live (see MembershipLifecycleService).
-- Created at: 2026-07-09

BEGIN;

-- 1. Allow the new statuses.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('active','grace','revoked','expired','pending','cancelled','suspended'));

-- 2. Lifecycle timestamps.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS grace_until DATE;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;

-- 3. Membership event history (payment/usage/renewed/suspended/expired/…).
CREATE TABLE IF NOT EXISTS membership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  payload JSONB,
  actor UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_membership_events_membership ON membership_events(membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_events_tenant ON membership_events(tenant_id, created_at DESC);

-- 4. One-time backfill: align existing rows whose dates already passed. Manual
--    'suspended'/'cancelled'/'pending' rows are left untouched. Existing 'expired'
--    rows are re-bucketed into grace/revoked by date.
UPDATE memberships
   SET status = 'grace',
       grace_until = end_date + INTERVAL '14 days'
 WHERE status IN ('active','expired')
   AND end_date < CURRENT_DATE
   AND end_date + INTERVAL '14 days' >= CURRENT_DATE;

UPDATE memberships
   SET status = 'revoked',
       grace_until = end_date + INTERVAL '14 days',
       revoked_at = COALESCE(revoked_at, NOW())
 WHERE status IN ('active','expired','grace')
   AND end_date + INTERVAL '14 days' < CURRENT_DATE;

COMMIT;
