-- Migration: 092_notification_templates
-- Description: Owner-editable notification texts.
--
--   Every automatic WhatsApp message this platform sends was a string literal in
--   TypeScript (~28 of them, across 10 modules). Changing one word — the wording
--   of the H-7 membership reminder, say — meant a code change and a redeploy, and
--   the owner had no way to see what the system sends on their behalf.
--
--   The catalogue of notifications (keys, triggers, allowed variables, default
--   bodies) stays in code: apps/backend/src/modules/notification/notification-catalog.ts.
--   This table holds ONLY per-tenant OVERRIDES. A tenant with no row for a key
--   gets the code default, so shipping a better default still reaches everyone
--   who never touched it, and "reset to default" is a DELETE.
--
--   `body` is nullable on purpose: a row may exist purely to record `enabled =
--   false` (owner switched a notification off but kept the stock wording).
-- Created at: 2026-08-08

BEGIN;

CREATE TABLE IF NOT EXISTS notification_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Matches NOTIFICATION_CATALOG[].key. Deliberately not an FK/enum: the
  -- catalogue lives in code and gains entries between migrations.
  template_key TEXT NOT NULL,
  -- NULL = use the code default body.
  body        TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_templates_tenant_key_uniq UNIQUE (tenant_id, template_key)
);

-- The renderer reads by (tenant, key) on every send; the unique constraint above
-- already provides that index, so no extra one is needed.

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notification_templates ON notification_templates;
CREATE POLICY tenant_isolation_notification_templates ON notification_templates
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Keep updated_at honest via the shared trigger installed in 004.
DROP TRIGGER IF EXISTS set_updated_at_notification_templates ON notification_templates;
CREATE TRIGGER set_updated_at_notification_templates
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;
