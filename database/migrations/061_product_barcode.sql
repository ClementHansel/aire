-- Migration: 061_product_barcode
-- Description: Product barcode support for scan-to-cart at POS and barcode labels.
--   Sellable products (rows in `services` with category='product') and inventory
--   items had no barcode. This adds a nullable `barcode` to both, uniquely indexed
--   per tenant. Barcode is opt-in: the enable toggle + symbology + scan/label
--   settings live in tenants.settings.barcode (default OFF); turning it on reveals
--   the barcode settings and the label designer in the UI.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);

-- Barcodes unique within a tenant (NULLs unconstrained).
CREATE UNIQUE INDEX IF NOT EXISTS uq_services_barcode
  ON services(tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_barcode
  ON inventory_items(tenant_id, barcode) WHERE barcode IS NOT NULL;

COMMIT;
