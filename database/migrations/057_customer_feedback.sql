-- Migration: 057_customer_feedback
-- Description: Customer feedback / rating / NPS capture. There was no way to
--   collect post-service satisfaction. This adds:
--     * feedback_requests  — one per completed/paid order (when enabled). Carries a
--       random public token; the customer is sent a WhatsApp link to a public form.
--     * feedback_responses — the submitted 1..5 rating, optional 0..10 NPS score,
--       free-text comment, and optional service/employee attribution.
--   Aggregates (avg rating, NPS = %promoters - %detractors, per-branch/per-employee
--   trends) are computed on read. The enable toggle lives in
--   tenants.settings.feedback (default OFF).
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS feedback_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id      UUID REFERENCES outlets(id) ON DELETE SET NULL,
  order_id       UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_phone VARCHAR(20),
  token          UUID NOT NULL DEFAULT gen_random_uuid(),
  channel        VARCHAR(12) NOT NULL DEFAULT 'whatsapp'
                   CHECK (channel IN ('whatsapp', 'link')),
  status         VARCHAR(12) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed', 'expired')),
  sent_at        TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_token ON feedback_requests(token);
CREATE INDEX IF NOT EXISTS idx_feedback_req_tenant ON feedback_requests(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_req_order ON feedback_requests(order_id);

CREATE TABLE IF NOT EXISTS feedback_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id   UUID REFERENCES outlets(id) ON DELETE SET NULL,
  request_id  UUID NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  nps         SMALLINT CHECK (nps BETWEEN 0 AND 10),
  comment     TEXT,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_resp_tenant ON feedback_responses(tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_resp_request ON feedback_responses(request_id);

COMMIT;
