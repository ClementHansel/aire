-- Migration: 053_wa_mock_outbox
-- Description: Records outbound WhatsApp sends captured while WAHA_MOCK mode is on
--   (final-dev bypass — no real WhatsApp number needed). Every reply that WOULD be
--   delivered to WAHA/Kapso is recorded here instead, so the full pipeline
--   (webhook parse → tenant resolve → cap → n8n/built-in AI → log → send) can be
--   exercised end-to-end and inspected. If production breaks with the flag OFF, the
--   fault is isolated to the WAHA↔WhatsApp segment (the third party), because this
--   layer is already proven green.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS wa_mock_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(10) NOT NULL DEFAULT 'waha', -- 'waha' | 'kapso'
  chat_id VARCHAR(64) NOT NULL,                 -- resolved WhatsApp chatId (e.g. 628xx@c.us)
  to_phone VARCHAR(32),                          -- raw destination as passed to sendText
  body TEXT NOT NULL,                            -- the message payload that would be sent
  session VARCHAR(64),                           -- WAHA session name (NULL for kapso)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_mock_outbox_tenant ON wa_mock_outbox(tenant_id, created_at DESC);

COMMIT;
