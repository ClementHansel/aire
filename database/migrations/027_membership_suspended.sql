-- 027_membership_suspended.sql
-- Redefine "suspended": a membership that is still within its paid duration but
-- has been MANUALLY blocked by a higher-level role due to a rule breach
-- (no longer an automatic post-expiry grace state). Expired now strictly means
-- past end_date. This adds 'suspended' to the allowed membership statuses.

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('active','expired','pending','cancelled','suspended'));

-- Optional audit columns for who/why/when a membership was suspended.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
