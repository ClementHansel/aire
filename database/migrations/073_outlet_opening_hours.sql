-- Migration: 073_outlet_opening_hours
-- Description: Structured opening hours per branch so the WhatsApp AI agent can
--   reliably answer "jam buka?" / "lokasi?" instead of guessing from free-text
--   prompt lines. Stored as JSONB keyed by weekday, e.g.
--     {"mon":{"open":"08:00","close":"20:00"}, "sun":{"closed":true}, ...}
--   NULL = not configured (agent falls back to a generic answer + address).
--   Location is the existing outlets.address column.
-- Created at: 2026-07-20

BEGIN;

ALTER TABLE outlets
  ADD COLUMN IF NOT EXISTS opening_hours JSONB;

COMMIT;
