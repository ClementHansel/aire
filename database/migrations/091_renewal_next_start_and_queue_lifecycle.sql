-- Migration: 091_renewal_next_start_and_queue_lifecycle
-- Description:
--   1. membership_renewals.next_start_date — the cashier may push the start of the
--      renewed period up to 7 days past the current expiry, so a customer who is
--      away does not pay for days they cannot use (AIRIN-157). NULL keeps the old
--      behaviour: the new period starts where the old one ended (or today, if the
--      old one already lapsed — AIRIN-156).
--   2. vehicle_queue lifecycle columns. The board now auto-starts service on
--      arrival and closes itself at midnight, and a car that was never served has
--      to leave an account of itself rather than silently disappearing
--      (AIRIN-170/171).
-- Created at: 2026-08-08

BEGIN;

ALTER TABLE membership_renewals
  ADD COLUMN IF NOT EXISTS next_start_date DATE;

-- When service actually began. Set on insert now that adding a car to the queue
-- IS the start of service; kept as a column (not derived from created_at) so the
-- served-duration stays meaningful if arrival and start ever diverge again.
ALTER TABLE vehicle_queue
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  -- Why an entry left the board without being served. Free text, written by the
  -- midnight sweep or by the cashier who cancelled it.
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  -- True when the midnight sweep closed it rather than a person.
  ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every existing entry was, in the old model, started when it was
-- created — leaving started_at NULL would report those cars as never served.
UPDATE vehicle_queue SET started_at = created_at WHERE started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_queue_open
  ON vehicle_queue (tenant_id, outlet_id, status)
  WHERE status IN ('waiting', 'serving');

COMMIT;
