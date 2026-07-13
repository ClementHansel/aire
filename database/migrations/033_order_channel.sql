-- Migration: 033_order_channel
-- Description: Record which ordering interface created an order (pos / kiosk /
--   customer). Enables interface-aware behavior (e.g. out-of-stock products are
--   blocked for customer/kiosk but still sellable at the POS) and channel analytics.
-- Created at: 2026-07-09

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(10) DEFAULT 'pos'
  CHECK (channel IS NULL OR channel IN ('pos','kiosk','customer'));

COMMIT;
