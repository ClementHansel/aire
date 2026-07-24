-- Migration: 083_kirim_provider
-- Description: Replace the Kapso WhatsApp cloud provider with kirimdev
--   (api.kirimdev.com), a Meta-compatible WhatsApp Cloud API wrapper. Adds
--   kirim_api_key + kirim_phone_id to agent_configs and outlet_agent_configs,
--   migrates any tenant/branch left on 'kapso' back to 'waha' (the only other
--   provider still supported), and narrows the wa_provider CHECK to
--   ('waha','kirim'). kapso_api_key is left in place (deprecated, unused) —
--   dropping it is a separate, deliberate follow-up, not bundled here.
-- Created at: 2026-07-25

BEGIN;

-- 1. New connection columns.
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS kirim_api_key TEXT,
  ADD COLUMN IF NOT EXISTS kirim_phone_id VARCHAR(64);

ALTER TABLE outlet_agent_configs
  ADD COLUMN IF NOT EXISTS kirim_api_key TEXT,
  ADD COLUMN IF NOT EXISTS kirim_phone_id VARCHAR(64);

-- 2. Data migration BEFORE narrowing the CHECK: any row still on the removed
--    'kapso' provider falls back to 'waha' (self-hosted) rather than being left
--    in a state the new constraint would reject.
UPDATE agent_configs SET wa_provider = 'waha' WHERE wa_provider = 'kapso';
UPDATE outlet_agent_configs SET wa_provider = 'waha' WHERE wa_provider = 'kapso';

-- 3. Replace the wa_provider CHECK on both tables: 'kapso' -> 'kirim'.
--    Inline CHECK constraints default to <table>_<column>_check.
ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS agent_configs_wa_provider_check;
ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_wa_provider_check CHECK (wa_provider IN ('waha', 'kirim'));

ALTER TABLE outlet_agent_configs DROP CONSTRAINT IF EXISTS outlet_agent_configs_wa_provider_check;
ALTER TABLE outlet_agent_configs
  ADD CONSTRAINT outlet_agent_configs_wa_provider_check CHECK (wa_provider IN ('waha', 'kirim'));

-- 4. kapso_api_key columns are deprecated (kept, non-destructive) in favor of
--    kirim_api_key/kirim_phone_id.
COMMENT ON COLUMN agent_configs.kapso_api_key IS 'Deprecated: Kapso provider removed 2026-07-25. Use kirim_api_key/kirim_phone_id instead.';
COMMENT ON COLUMN outlet_agent_configs.kapso_api_key IS 'Deprecated: Kapso provider removed 2026-07-25. Use kirim_api_key/kirim_phone_id instead.';

COMMIT;
