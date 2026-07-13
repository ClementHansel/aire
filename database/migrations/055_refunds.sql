-- Migration: 055_refunds
-- Description: First-class refund / partial-refund flow. Until now the only way
--   to reverse a paid order was `voidOrder`, which cancels the record but
--   explicitly leaves money untouched ("refund must be issued separately"), and
--   nothing recorded the money actually returned. This adds:
--     * refunds       — one money-out event against an order (partial or full),
--                       its own number, reason, method, tax reversed, and the
--                       POS shift it hit (for cash-drawer reconciliation).
--     * refund_items  — the per-order-item lines being refunded (qty + amount),
--                       enabling partial and per-line refunds.
--   The accounting module auto-posts a balanced reversal on RefundIssued keyed
--   idempotently by (source_type='refund', source_id=refund.id).
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS refunds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id      UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  refund_number  VARCHAR(30) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('pending', 'completed', 'cancelled')),
  reason         TEXT NOT NULL,
  refund_method  VARCHAR(20) NOT NULL,            -- cash | bank | qris | edc | transfer
  total          DECIMAL(14,2) NOT NULL,          -- gross amount returned
  tax_reversed   DECIMAL(14,2) NOT NULL DEFAULT 0,-- PPN portion of `total`
  shift_id       UUID REFERENCES pos_shifts(id) ON DELETE SET NULL,
  approved_by    UUID REFERENCES users(id),
  created_by     UUID,
  pin_used       BOOLEAN NOT NULL DEFAULT false,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_tenant ON refunds(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_number ON refunds(tenant_id, refund_number);

CREATE TABLE IF NOT EXISTS refund_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id     UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  quantity      DECIMAL(14,2) NOT NULL,
  amount        DECIMAL(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON refund_items(refund_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_order_item ON refund_items(order_item_id);

COMMIT;
