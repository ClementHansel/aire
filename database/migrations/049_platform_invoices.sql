-- 049_platform_invoices.sql
-- Real platform billing: invoices the PLATFORM issues to each tenant for their
-- subscription. Distinct from the estimated-MRR rollup the Billing page already
-- shows (that is derived on the fly). Prices come from `platform_plans` at the
-- time an invoice is generated (snapshotted onto the row so later price changes
-- don't rewrite history). One invoice per (tenant, period) is enforced.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period        VARCHAR(7) NOT NULL,                 -- 'YYYY-MM' the invoice covers
  plan_code     VARCHAR(64),                         -- tenant.plan snapshot at generation
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0,    -- monthly-equivalent price (IDR)
  currency      VARCHAR(8) NOT NULL DEFAULT 'IDR',
  status        VARCHAR(16) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','paid','overdue','void')),
  issued_at     TIMESTAMPTZ,                         -- set when moved to 'sent'
  due_date      DATE,
  paid_at       TIMESTAMPTZ,                         -- set when moved to 'paid'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period)
);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON platform_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON platform_invoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_period ON platform_invoices(period);

COMMIT;
