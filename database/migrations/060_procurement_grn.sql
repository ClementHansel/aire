-- Migration: 060_procurement_grn
-- Description: Goods Receipt Notes (GRN) with per-line partial receiving. Receiving
--   a PO was an all-or-nothing status flip (draft/ordered -> received) with no
--   record of how much of each line actually arrived. This adds:
--     * purchase_order_items.received_quantity — running received qty per line.
--     * purchase_orders 'partially_received' status.
--     * goods_receipts / goods_receipt_items — each physical delivery against a PO,
--       with per-line quantity + unit cost. Receiving increments received_quantity,
--       restocks inventory (via the existing adjustStock path), and recomputes PO
--       status to 'received' (all lines full) or 'partially_received'.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS received_quantity DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Widen PO status to allow partial receipts.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled'));

CREATE TABLE IF NOT EXISTS goods_receipts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id       UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  grn_number  VARCHAR(40) NOT NULL,
  received_by UUID,
  notes       TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grn_tenant ON goods_receipts(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipts(po_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_grn_number ON goods_receipts(tenant_id, grn_number);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id      UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id  UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  quantity    DECIMAL(14,2) NOT NULL,
  unit_cost   DECIMAL(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON goods_receipt_items(grn_id);

COMMIT;
