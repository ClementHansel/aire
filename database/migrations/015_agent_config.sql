-- Migration: 015_agent_config
-- Description: Agentic AI configuration per tenant — base prompt, WA connection
--   (WAHA QR / Kapso), per-user daily message cap, product knowledge, skills,
--   escalation number, and a global AI-reply on/off switch.
-- Created at: 2026-06-30

BEGIN;

CREATE TABLE IF NOT EXISTS agent_configs (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  base_prompt TEXT,
  product_knowledge TEXT,
  skills TEXT,
  escalation_number VARCHAR(20),
  max_messages_per_day INTEGER NOT NULL DEFAULT 50,
  wa_provider VARCHAR(10) NOT NULL DEFAULT 'waha' CHECK (wa_provider IN ('waha','kapso')),
  wa_number VARCHAR(20),
  waha_session VARCHAR(100),
  kapso_api_key TEXT,
  ai_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
