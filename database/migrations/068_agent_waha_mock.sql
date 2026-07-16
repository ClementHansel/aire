-- Migration: 068_agent_waha_mock
-- Description: Per-tenant WAHA simulation toggle. Previously WAHA_MOCK was a
--   process-wide env flag (all tenants or none). This adds a per-tenant switch on
--   agent_configs so a demo tenant can run the WhatsApp pipeline in simulation
--   (outbound captured to wa_mock_outbox) while other tenants use the real WAHA
--   connection on the same server. Effective mock = env WAHA_MOCK (global force)
--   OR this per-tenant flag.
-- Created at: 2026-07-16

BEGIN;

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS waha_mock BOOLEAN NOT NULL DEFAULT false;

COMMIT;
