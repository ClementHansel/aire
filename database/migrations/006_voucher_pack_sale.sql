-- =============================================================================
-- Migration 006: Voucher pack sale support
-- Adds the sale price and relative validity to voucher templates, and a
-- per-pack expiry date set at sale time. These were missing from the original
-- schema, which modeled the discount value but not what the customer pays.
-- =============================================================================

ALTER TABLE voucher_templates
  ADD COLUMN IF NOT EXISTS sale_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validity_days INTEGER;

-- Per-pack expiry (purchase date + template.validity_days). NULL = no expiry
-- or falls back to the template's absolute expiry_date.
ALTER TABLE voucher_packs
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

COMMENT ON COLUMN voucher_templates.sale_price IS 'Price the customer pays to buy this pack (IDR).';
COMMENT ON COLUMN voucher_templates.validity_days IS 'Days a sold pack stays valid from purchase date. NULL = use template expiry_date.';
COMMENT ON COLUMN voucher_packs.expiry_date IS 'Expiry for this sold pack, computed at sale time from the template validity.';
