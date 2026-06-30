-- Migration: 011_business_units
-- Description: Add co-located business unit separation (AIRE car wash / LEAD detailing).
--   - Tags services to a business unit (per-unit catalog)
--   - Tags every transaction to a business unit
--   - Records the payment channel (which unit's bank/EDC/merchant account)
--   - Records the salesperson name separately from the cashier
-- Existing rows default to AIRE (the original car wash scope).
-- Created at: 2026-06-30

BEGIN;

-- ── Services: which business unit's catalog a service belongs to ───────────────
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS business_unit VARCHAR(10) NOT NULL DEFAULT 'AIRE'
    CHECK (business_unit IN ('AIRE', 'LEAD'));

CREATE INDEX IF NOT EXISTS idx_services_business_unit
  ON services(tenant_id, business_unit, is_active);

-- ── Orders: business unit tag + payment channel + salesperson ──────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS business_unit VARCHAR(10) NOT NULL DEFAULT 'AIRE'
    CHECK (business_unit IN ('AIRE', 'LEAD'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(10)
    CHECK (payment_channel IS NULL OR payment_channel IN ('AIRE', 'LEAD'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_orders_business_unit
  ON orders(tenant_id, business_unit, created_at);

COMMIT;
