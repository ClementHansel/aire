-- Migration: 093_ai_chat_and_wa_whitelist
-- Description: A real chat surface for the AI assistant + a WhatsApp staff whitelist.
--
--   1) agent_chat_sessions gains what a normal chat product needs:
--      - `scope`: 'tenant' (the owner/staff co-pilot in /dashboard/assistant) or
--        'platform' (the super-admin console in /admin/assistant). Platform
--        sessions belong to no tenant, so `tenant_id` becomes NULLABLE and a
--        CHECK ties the two together: tenant scope REQUIRES a tenant, platform
--        scope FORBIDS one.
--      - `archived_at` / `pinned`: soft-delete + pin, so history is a managed
--        list rather than an append-only log.
--      - `auto_titled`: false once a human renames the thread, so the automatic
--        titler never overwrites a title someone chose.
--
--   2) wa_whitelist_numbers: WhatsApp numbers that talk to the FULL business
--      agent instead of the customer-facing one. A number in here is treated as
--      staff: the inbound message runs the same tool-loop the dashboard
--      assistant runs (all business tools, tenant-scoped), so an owner can ask
--      "revenue today?" from their phone. `access_level` decides whether they
--      may also trigger action tools ('full') or only read ones ('read_only').
--
--      `phone` stores BARE DIGITS (no +, spaces, or @c.us) in international form
--      — the service normalizes before writing — so the inbound lookup is a
--      plain equality match on an indexed column rather than a regex scan.
-- Created at: 2026-08-11

BEGIN;

-- ── 1) Chat sessions: scope + lifecycle ─────────────────────────────────────

ALTER TABLE agent_chat_sessions
  ADD COLUMN IF NOT EXISTS scope       VARCHAR(20)  NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_titled BOOLEAN      NOT NULL DEFAULT true;

ALTER TABLE agent_chat_sessions ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE agent_chat_sessions DROP CONSTRAINT IF EXISTS agent_chat_sessions_scope_tenant_chk;
ALTER TABLE agent_chat_sessions
  ADD CONSTRAINT agent_chat_sessions_scope_tenant_chk CHECK (
    (scope = 'tenant'   AND tenant_id IS NOT NULL) OR
    (scope = 'platform' AND tenant_id IS NULL)
  );

-- The history list is always "my threads, newest first", filtered by scope.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_scope_user
  ON agent_chat_sessions(scope, user_id, updated_at DESC);

-- ── 2) WhatsApp staff whitelist ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wa_whitelist_numbers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Bare international digits, e.g. '628123456789'. Normalized by the service.
  phone        TEXT NOT NULL,
  label        TEXT NOT NULL,
  -- 'full' = may call action tools (subject to the tenant's approval mode);
  -- 'read_only' = the agent can look but not touch.
  access_level VARCHAR(20) NOT NULL DEFAULT 'full',
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  -- Optional: bind the number to a real user so tools run with their identity.
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wa_whitelist_numbers_access_chk CHECK (access_level IN ('full', 'read_only')),
  CONSTRAINT wa_whitelist_numbers_tenant_phone_uniq UNIQUE (tenant_id, phone)
);

-- The inbound hot path looks up (tenant, phone); the unique constraint indexes it.

ALTER TABLE wa_whitelist_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_wa_whitelist_numbers ON wa_whitelist_numbers;
CREATE POLICY tenant_isolation_wa_whitelist_numbers ON wa_whitelist_numbers
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- A whitelisted WhatsApp thread IS a chat thread: it runs the same brain and
-- deserves the same continuity ("and yesterday?" must still work) and the same
-- visibility (the owner sees it in the dashboard history). Binding the WhatsApp
-- conversation to a chat session gives both. ON DELETE SET NULL so archiving a
-- thread from the dashboard simply starts the next WhatsApp turn fresh.
ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS chat_session_id UUID
    REFERENCES agent_chat_sessions(id) ON DELETE SET NULL;

-- Keep updated_at honest via the shared trigger installed in 004.
DROP TRIGGER IF EXISTS set_updated_at_wa_whitelist_numbers ON wa_whitelist_numbers;
CREATE TRIGGER set_updated_at_wa_whitelist_numbers
  BEFORE UPDATE ON wa_whitelist_numbers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;
