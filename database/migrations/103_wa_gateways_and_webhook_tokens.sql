-- Migration: 103_wa_gateways_and_webhook_tokens
-- Description: Make the WhatsApp TRANSPORT tenant-isolated. Three holes are
--   closed here; the matching service changes are in whatsapp.service.ts and
--   agent-config.service.ts.
--
--   1. GATEWAY REGISTRY (wa_gateways). The deployed WAHA image is tier CORE,
--      which serves exactly ONE session and it must be named 'default'. So a
--      session name alone cannot address a second tenant's line — the backend
--      also has to know WHICH gateway to talk to. wa_gateways is that registry.
--      It is PLATFORM-owned (super-admin only) on purpose: a tenant-editable
--      base_url would let any owner point the backend at an internal address
--      (SSRF). agent_configs.wa_gateway_id / outlet_agent_configs.wa_gateway_id
--      NULL means "the platform default gateway" = env WAHA_URL/WAHA_API_KEY,
--      so every existing line keeps working untouched and no env secret is
--      copied into the database.
--
--   2. SESSION UNIQUENESS PER GATEWAY. Today agent_configs.waha_session has no
--      constraint at all (migration 015), so two tenants could both claim
--      'primary' and resolveBySession()'s `LIMIT 1` would hand inbound to
--      whichever row Postgres returned. Uniqueness is scoped to the GATEWAY,
--      not global: with one Core container per tenant, two tenants legitimately
--      both use the session name 'default' on different gateways. Cross-table
--      collisions (tenant line vs branch line on the same gateway) cannot be
--      expressed as one index and stay a service-layer check, now applied on
--      BOTH write paths rather than only the branch one.
--
--   3. WEBHOOK TOKEN. /api/whatsapp/webhook was public and unauthenticated, and
--      identified the tenant by a guessable session name. Each line now gets an
--      unguessable wa_webhook_token; WAHA is configured to post to
--      /api/whatsapp/webhook/<token>. That both authenticates the caller and
--      disambiguates inbound, which the gateway-per-tenant layout REQUIRES —
--      every Core container reports session 'default', so the session name is
--      no longer a usable discriminator.
-- Created at: 2026-09-18

BEGIN;

-- 1. Platform-owned gateway registry. ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_gateways (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,
  base_url   VARCHAR(255) NOT NULL,
  api_key    TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Per-line gateway pointer + webhook token. ───────────────────────────────
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS wa_gateway_id UUID REFERENCES wa_gateways(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wa_webhook_token VARCHAR(64);

ALTER TABLE outlet_agent_configs
  ADD COLUMN IF NOT EXISTS wa_gateway_id UUID REFERENCES wa_gateways(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wa_webhook_token VARCHAR(64);

-- Backfill a token for every existing line so nothing has to be re-provisioned
-- by hand. encode(gen_random_bytes(24),'hex') = 48 hex chars of CSPRNG.
UPDATE agent_configs
   SET wa_webhook_token = encode(gen_random_bytes(24), 'hex')
 WHERE wa_webhook_token IS NULL;
UPDATE outlet_agent_configs
   SET wa_webhook_token = encode(gen_random_bytes(24), 'hex')
 WHERE wa_webhook_token IS NULL;

-- Tokens are the inbound identity, so they must be unique across BOTH tables.
-- Two indexes can only enforce per-table uniqueness; 24 CSPRNG bytes make a
-- cross-table collision negligible, and the resolver checks both tables.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_configs_webhook_token
  ON agent_configs (wa_webhook_token) WHERE wa_webhook_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_agent_configs_webhook_token
  ON outlet_agent_configs (wa_webhook_token) WHERE wa_webhook_token IS NOT NULL;

-- 3. Session uniqueness, scoped per gateway. ─────────────────────────────────
-- The all-zero UUID stands in for "platform default gateway" (NULL), mirroring
-- the sentinel migration 067 uses for a NULL outlet_id.
ALTER TABLE outlet_agent_configs DROP CONSTRAINT IF EXISTS outlet_agent_configs_waha_session_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_configs_gateway_session
  ON agent_configs ((COALESCE(wa_gateway_id, '00000000-0000-0000-0000-000000000000'::uuid)), waha_session)
  WHERE waha_session IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_agent_configs_gateway_session
  ON outlet_agent_configs ((COALESCE(wa_gateway_id, '00000000-0000-0000-0000-000000000000'::uuid)), waha_session)
  WHERE waha_session IS NOT NULL;

COMMIT;
