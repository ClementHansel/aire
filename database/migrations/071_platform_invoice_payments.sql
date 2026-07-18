-- 071_platform_invoice_payments.sql
-- Wire platform subscription invoices to the SAME payment-gateway abstraction the
-- POS uses. These columns let a platform invoice hold a gateway checkout so a
-- tenant can pay their subscription self-serve, and so a gateway webhook can
-- confirm it (mirrors orders.payment_reference for the POS QRIS flow).

BEGIN;

ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS payment_provider  VARCHAR(32);
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS checkout_url      TEXT;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS checkout_expires_at TIMESTAMPTZ;

-- Look up an invoice fast by the gateway transaction id when a webhook arrives.
CREATE INDEX IF NOT EXISTS idx_platform_invoices_payment_ref
  ON platform_invoices(payment_reference)
  WHERE payment_reference IS NOT NULL;

COMMIT;
