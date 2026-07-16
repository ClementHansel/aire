-- Migration: 067_outlet_wa_configs
-- Description: Per-branch WhatsApp. Opt-in tenant toggle
--   (agent_configs.per_branch_wa_enabled) plus a per-outlet connection table
--   (outlet_agent_configs) so each branch can run its own WhatsApp line
--   (number / WAHA session / provider / Kapso key). Behaviour fields (escalation,
--   daily cap, AI prompt/knowledge/model) stay tenant-wide. Conversations gain an
--   outlet_id so branch lines don't share a thread for the same customer phone.
-- Created at: 2026-07-16

BEGIN;

-- 1. Tenant-level opt-in toggle.
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS per_branch_wa_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. Per-branch connection override (one row per outlet). Only the connection
--    columns live here; everything else is inherited from agent_configs.
--    waha_session is UNIQUE (inbound discriminator); cross-table collision with
--    agent_configs.waha_session is rejected in the service layer on write.
CREATE TABLE IF NOT EXISTS outlet_agent_configs (
  outlet_id     UUID PRIMARY KEY REFERENCES outlets(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_provider   VARCHAR(10) NOT NULL DEFAULT 'waha' CHECK (wa_provider IN ('waha','kapso')),
  wa_number     VARCHAR(20),
  waha_session  VARCHAR(100) UNIQUE,
  kapso_api_key TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outlet_agent_configs_tenant ON outlet_agent_configs(tenant_id);

-- 3. Scope conversations to a branch. Existing rows keep outlet_id NULL (tenant
--    central line). Replace UNIQUE(tenant_id, chat_id) with a coalescing
--    expression index so (tenant, chat) is unique per branch AND for the
--    tenant line (NULL outlet_id maps to the all-zero UUID sentinel).
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_tenant_id_chat_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_conv_tenant_outlet_chat
  ON wa_conversations (tenant_id, chat_id, (COALESCE(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)));

COMMIT;
