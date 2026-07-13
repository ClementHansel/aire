-- Migration: 032_cogs
-- Description: COGS foundation — product recipes (BOM), non-physical cost
--   components, unit-of-measure conversions, per-line cost snapshots, sale/return
--   stock movements, and stock opname (physical count) with variance.
--   Products are the existing `services` rows (there is no separate products table).
-- Created at: 2026-07-09

BEGIN;

-- 1. Recipe / BOM: physical inventory consumed per ONE unit of a product (service).
CREATE TABLE IF NOT EXISTS service_recipe_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,4) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, inventory_item_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_components_service ON service_recipe_components(service_id);

-- 2. Non-physical cost components (tax, profit, water, electricity …). Reusable
--    per-tenant types, then per-product values. kind: fixed amount or % of price.
CREATE TABLE IF NOT EXISTS cost_component_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(12) NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed','percentage')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS service_cost_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  component_type_id UUID NOT NULL REFERENCES cost_component_types(id) ON DELETE RESTRICT,
  value NUMERIC(14,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, component_type_id)
);
CREATE INDEX IF NOT EXISTS idx_service_cost_components_service ON service_cost_components(service_id);

-- 3. Unit-of-measure conversions per item (e.g. buy/stock in kg, consume in g:
--    from_unit 'g' → to_unit 'kg' factor 0.001). Recipe qty is converted to the
--    item's stock unit at deduction time.
CREATE TABLE IF NOT EXISTS uom_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  from_unit VARCHAR(20) NOT NULL,
  to_unit VARCHAR(20) NOT NULL,
  factor NUMERIC(18,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inventory_item_id, from_unit, to_unit)
);

-- 4. Frozen unit COGS on each order line at sale time (so margin reports don't
--    drift when a recipe later changes).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost_snapshot NUMERIC(14,2);

-- 5. Sale + sale-return stock movements (auto-deduct on order, restock on cancel).
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_type_check
  CHECK (type IN ('in','out','adjustment','sale','sale_return'));

-- 6. Stock opname (physical count) with per-item expected/counted/variance.
CREATE TABLE IF NOT EXISTS stock_opname (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','closed')),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS stock_opname_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_id UUID NOT NULL REFERENCES stock_opname(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  expected_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  counted_qty NUMERIC(14,4),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance NUMERIC(14,4),
  variance_value NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opname_id, inventory_item_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_opname_tenant ON stock_opname(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_opname_items_opname ON stock_opname_items(opname_id);

COMMIT;
