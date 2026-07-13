-- Migration: 038_n8n_agent_flows
-- Description: n8n-style drag-and-drop agent builder integration.
--   * agent_flows  = platform-level CATALOG of workflows built by the super-admin
--                    in the hosted n8n instance. Tenants only SELECT from this.
--   * agent_configs gains routing columns so a tenant can point their WhatsApp
--     assistant (and automations) at a chosen n8n flow instead of the built-in
--     runtime, plus a per-tenant bridge_token that n8n uses to call aire back.
-- Created at: 2026-07-11

BEGIN;

-- Catalog of n8n workflows the platform admin has published. Kind separates the
-- conversational (whatsapp) flows from the scheduled (automation) flows.
CREATE TABLE IF NOT EXISTS agent_flows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'whatsapp' CHECK (kind IN ('whatsapp', 'automation')),
  webhook_url  TEXT NOT NULL,            -- the n8n Production Webhook URL for this flow
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_flows_kind_enabled ON agent_flows(kind, enabled);

-- Per-tenant routing + callback secret. agent_configs is the existing one-row-per-tenant
-- WhatsApp/Agentic-AI config table (migration 015).
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS routing_mode           TEXT NOT NULL DEFAULT 'builtin'
                                                   CHECK (routing_mode IN ('builtin', 'n8n')),
  ADD COLUMN IF NOT EXISTS n8n_flow_id            UUID REFERENCES agent_flows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS n8n_automation_flow_id UUID REFERENCES agent_flows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bridge_token           TEXT;

-- Fast reverse-lookup: n8n presents the bridge_token, we resolve the tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_configs_bridge_token
  ON agent_configs(bridge_token) WHERE bridge_token IS NOT NULL;

COMMIT;
