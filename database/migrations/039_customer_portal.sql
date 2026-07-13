-- Customer portal: capture email at registration + WhatsApp-OTP login store.
BEGIN;

-- Email is optional; the WhatsApp number is the existing customers.phone.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Short-lived OTP codes for customer portal login (WhatsApp delivery).
-- One active code per (tenant, phone); re-request overwrites. Codes are hashed.
CREATE TABLE IF NOT EXISTS customer_otps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_normalized VARCHAR(20) NOT NULL,
  code_hash        TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  attempts         INT NOT NULL DEFAULT 0,
  last_sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, phone_normalized)
);

COMMIT;
