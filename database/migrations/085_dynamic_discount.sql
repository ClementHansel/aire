-- Migration: 085_dynamic_discount
-- Description: AIRIN-122/AIRIN-123 — "Tambahkan flag dynamic discount (fixed /
--   percentage opsi) dengan maximal discount, agar cashier bisa input dynamic
--   discount untuk product/service tertentu yang sudah di set di dashboard."
--   Products and services are the same `services` row (category='product' vs
--   'car_wash'/'add_on'), so one schema change covers both tickets.
--
--   Today the POS manual-discount input is unconditional per cart line, capped
--   by a single tenant-wide percentage. This adds a PER-ITEM opt-in flag with a
--   PER-ITEM maximum (Rupiah when fixed, percent 0-100 when percentage) so the
--   dashboard can control which items a cashier may discount, and by how much.
--   Gating the POS input on this flag is a separate ticket (AIRIN-121).
-- Created at: 2026-07-29

BEGIN;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS dynamic_discount_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dynamic_discount_kind VARCHAR(10),
  ADD COLUMN IF NOT EXISTS max_discount NUMERIC(12,2);

-- kind is NULL while the flag is off; once set it must be one of the two
-- supported discount shapes.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_dynamic_discount_kind_check;
ALTER TABLE services
  ADD CONSTRAINT services_dynamic_discount_kind_check
  CHECK (dynamic_discount_kind IS NULL OR dynamic_discount_kind IN ('fixed', 'percentage'));

-- Coherence: turning the flag on obligates a kind + a positive cap. This keeps
-- "enabled but no cap configured" out of the database entirely, rather than
-- relying on every reader to re-derive that invariant.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_dynamic_discount_coherent_check;
ALTER TABLE services
  ADD CONSTRAINT services_dynamic_discount_coherent_check
  CHECK (
    NOT dynamic_discount_enabled
    OR (dynamic_discount_kind IS NOT NULL AND max_discount IS NOT NULL AND max_discount > 0)
  );

COMMENT ON COLUMN services.dynamic_discount_enabled IS 'Per-item opt-in: whether a cashier may apply a manual discount to this product/service at all (AIRIN-121/122/123).';
COMMENT ON COLUMN services.dynamic_discount_kind IS 'Shape of the per-item discount cap: fixed (Rupiah) or percentage (0-100). NULL when dynamic_discount_enabled is false.';
COMMENT ON COLUMN services.max_discount IS 'Per-item discount ceiling. Rupiah amount when dynamic_discount_kind=fixed, percent (0-100) when =percentage.';

COMMIT;
