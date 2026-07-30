-- Migration: 089_pack_lines_on_orders
-- Description: Samuel 2026-07-30 — "Jadi si jual paket dan pesanan baru itu di
--   satu tempat aja bro biar enak ga terpisah halamannya supaya jadi 1 transaksi."
--
--   Until now a membership plan / voucher pack could only be sold on its OWN
--   order: PosCheckoutService.createPackOrder writes an order with no line items
--   at all, because order_items.service_id is NOT NULL and a plan is not a
--   service. That forced the cashier onto a second page (/pos/*/sell-pack) and
--   produced a second order + second payment for what is really one transaction
--   ("customer datang cuci, pas bayar berhasil di-upsell langganan bulanan").
--
--   This lets a pack sit on an ordinary cart line, so one order can carry both
--   the wash and the plan: one payment, one receipt, one shift, one accounting
--   entry, and — the point of the ticket — one place in the reports where the
--   upsell is visible.
--
--   service_id becomes nullable and item_type says what the line actually is.
--   The name is snapshotted on the line (item_name) so a renamed or deleted plan
--   never rewrites history, matching how unit_price already snapshots price.
-- Created at: 2026-07-30

BEGIN;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS item_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS membership_plan_id UUID REFERENCES membership_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_template_id UUID REFERENCES voucher_templates(id) ON DELETE SET NULL;

-- Existing rows are all ordinary service lines; the DEFAULT already covers them.
ALTER TABLE order_items ALTER COLUMN service_id DROP NOT NULL;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_item_type_check;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_item_type_check
  CHECK (item_type IN ('service', 'membership_plan', 'voucher_pack'));

-- Every line must point at exactly the thing its type claims. Without this a
-- pack line with a dangling service_id (or a service line with none) would read
-- as valid and quietly corrupt the product-mix report.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_type_target_check;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_type_target_check
  CHECK (
    (item_type = 'service'         AND service_id IS NOT NULL AND membership_plan_id IS NULL AND voucher_template_id IS NULL)
    OR (item_type = 'membership_plan' AND service_id IS NULL AND membership_plan_id IS NOT NULL AND voucher_template_id IS NULL)
    OR (item_type = 'voucher_pack'    AND service_id IS NULL AND membership_plan_id IS NULL AND voucher_template_id IS NOT NULL)
  );

-- A pack line carries no services row to join for its label, so the snapshot is
-- mandatory for those types (and optional for services, which still join).
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pack_name_check;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_pack_name_check
  CHECK (item_type = 'service' OR item_name IS NOT NULL);

-- The product-mix report groups every line by type; without this it degrades to
-- a seq scan over all history once a tenant has a year of orders.
CREATE INDEX IF NOT EXISTS idx_order_items_item_type ON order_items(item_type);

COMMENT ON COLUMN order_items.item_type IS 'What this line sells: service (joins services), membership_plan, or voucher_pack. Packs used to require their own order (createPackOrder) — see migration 089.';
COMMENT ON COLUMN order_items.item_name IS 'Name snapshotted at sale time. Required for pack lines (no services row to join); optional for service lines.';
COMMENT ON COLUMN order_items.membership_plan_id IS 'Plan sold on this line. Set only when item_type = membership_plan.';
COMMENT ON COLUMN order_items.voucher_template_id IS 'Voucher pack sold on this line. Set only when item_type = voucher_pack.';

COMMIT;
