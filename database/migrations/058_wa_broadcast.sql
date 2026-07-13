-- Migration: 058_wa_broadcast
-- Description: WhatsApp marketing broadcast / campaign blast. The WA path today is
--   reactive 1:1 only with no outbound campaign tool and no send throttle. This adds:
--     * broadcast_campaigns  — a named message + audience filter + status + throttle
--       (messages/min) + progress counters. The sender paces sends to honour the
--       throttle (the raw WA send path has none) and respects WAHA_MOCK for dry-runs.
--     * broadcast_recipients — the resolved recipient list with per-recipient status,
--       including `skipped_no_consent` for non-opted-in customers.
--     * customers.wa_consent  — opt-in flag; non-consented recipients are excluded
--       unless the owner explicitly overrides (ban-risk mitigation).
--   Ban-risk safeguards (consent filter, throttle, must-acknowledge, mock dry-run)
--   are enforced in the service/UI, not the schema.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS wa_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_consent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             VARCHAR(160) NOT NULL,
  message          TEXT NOT NULL,
  audience_filter  JSONB NOT NULL DEFAULT '{}',    -- { segment, outletId?, tag?, ... }
  status           VARCHAR(12) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','sending','paused','completed','cancelled')),
  scheduled_at     TIMESTAMPTZ,
  throttle_per_min INTEGER NOT NULL DEFAULT 20,
  include_no_consent BOOLEAN NOT NULL DEFAULT false,-- owner override; audited
  acknowledged_risk  BOOLEAN NOT NULL DEFAULT false,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  skipped_count    INTEGER NOT NULL DEFAULT 0,
  created_by       UUID,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_broadcast_tenant ON broadcast_campaigns(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
  name         VARCHAR(255),
  phone        VARCHAR(20) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed','skipped_no_consent')),
  error        TEXT,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign ON broadcast_recipients(campaign_id, status);

COMMIT;
