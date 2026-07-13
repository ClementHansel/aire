-- Migration: 043_catalog_applies_to
-- Description: Scope categories and brands to what kind of item they label —
--   'service', 'product', or 'both'. Lets the Catalog page list service vs
--   product labels separately, and lets the Add/Edit forms filter the Brand &
--   Category dropdowns to the matching item type. Existing rows default to
--   'both' so nothing that was previously selectable disappears.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'both'
    CHECK (applies_to IN ('service', 'product', 'both'));

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'both'
    CHECK (applies_to IN ('service', 'product', 'both'));

COMMIT;
