-- Migration: 078_platform_llm_config
-- Description: Seed the platform-wide LLM connection (provider + model) in
--   platform_config.config.llm. The LLM account is now Airin's own, shared by
--   ALL tenants — set once by a super-admin (Admin → Platform Config → AI) instead
--   of per tenant. Preserves the qwen default model; the API key is added via the UI.
--   Does NOT touch any existing config.llm.api_key_encrypted if present.
-- Created at: 2026-07-20

BEGIN;

INSERT INTO platform_config (id, config, updated_at)
VALUES (
  'default',
  jsonb_build_object('llm', jsonb_build_object('provider', 'openrouter', 'model', 'qwen/qwen3.5-flash-02-23')),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  config = jsonb_set(
    COALESCE(platform_config.config, '{}'::jsonb),
    '{llm}',
    COALESCE(platform_config.config->'llm', '{}'::jsonb)
      || jsonb_build_object('provider', 'openrouter', 'model', 'qwen/qwen3.5-flash-02-23'),
    true
  ),
  updated_at = NOW();

COMMIT;
