-- Migration: 075_orders_public_token
-- Description: Public, unguessable token for an order so the WhatsApp payment
--   thank-you message can link the customer to a public receipt/invoice
--   (/receipt/:token) without exposing the internal order id or requiring login.
--   The token is minted at payment time by the payment-notification path; NULL
--   for orders that never needed a public link. Multiple NULLs are allowed under
--   a UNIQUE constraint in Postgres, so no partial index is required.
-- Created at: 2026-07-20

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS public_token TEXT;

-- Enforce uniqueness of minted tokens (NULLs are exempt).
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_public_token
  ON orders (public_token)
  WHERE public_token IS NOT NULL;

COMMIT;
