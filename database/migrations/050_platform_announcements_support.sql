-- 050_platform_announcements_support.sql
-- Two platform-admin surfaces:
--  1. platform_announcements — messages the platform broadcasts to tenants
--     (all tenants, a plan cohort, or one tenant). Read by the tenant dashboard
--     later; for now the admin authors/publishes them.
--  2. platform_support_notes — internal notes the super-admin keeps against a
--     tenant (the Support page becomes a lightweight CRM/ticket log). Not visible
--     to the tenant.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_announcements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  severity      VARCHAR(16) NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info','warning','critical')),
  audience      VARCHAR(16) NOT NULL DEFAULT 'all'
                CHECK (audience IN ('all','plan','tenant')),
  target        VARCHAR(255),                        -- plan code (audience=plan) or tenant id (audience=tenant)
  published     BOOLEAN NOT NULL DEFAULT false,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_pub ON platform_announcements(published);

CREATE TABLE IF NOT EXISTS platform_support_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  pinned        BOOLEAN NOT NULL DEFAULT false,
  author_id     UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_support_notes_tenant ON platform_support_notes(tenant_id);

COMMIT;
