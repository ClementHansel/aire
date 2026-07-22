-- Migration: 082_void_pin_requests
-- Description: One-time, emailed 6-digit admin PIN for voiding an order after
--   the free-void window (PRD 2026-06-26 ~L391: "admin PIN (6-digit via email
--   to owner/admin)"). Replaces the static preset (users.admin_pin_hash,
--   seeded "1234") for the order-void flow — every PIN is generated fresh,
--   single-use, short-lived, and delivered to the tenant owner's email
--   instead of being a shared secret cashiers can pass around.
--
--   users.admin_pin_hash is left in place (still read by refund.service.ts's
--   separate void-authorization check) but is no longer used by
--   order.service.ts voidOrder.
-- Created at: 2026-07-22

BEGIN;

CREATE TABLE IF NOT EXISTS void_pin_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  pin_hash VARCHAR(255) NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast "latest live PIN for this order" lookup (voidOrder verification) and
-- "invalidate priors on a new request" update both filter on this shape.
CREATE INDEX IF NOT EXISTS idx_void_pin_requests_order_active
  ON void_pin_requests(tenant_id, order_id, created_at DESC)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE void_pin_requests IS 'One-time 6-digit PIN emailed to the tenant owner to authorize voiding an order after the free-void window. Single-use (consumed_at) and short-lived (expires_at).';
COMMENT ON COLUMN void_pin_requests.order_id IS 'Order the PIN authorizes voiding. A new request invalidates any prior unconsumed PIN for the same order.';
COMMENT ON COLUMN void_pin_requests.requested_by IS 'User (cashier/admin) who requested the PIN — not who used it.';

COMMIT;
