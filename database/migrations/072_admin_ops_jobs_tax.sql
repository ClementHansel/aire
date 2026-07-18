-- 072_admin_ops_jobs_tax.sql
-- Three admin-console maturity features:
--   1. system_jobs — heartbeat table so the platform admin can see that scheduled
--      background jobs (billing/dunning, finance automation, membership lifecycle…)
--      actually ran, when, and with what outcome. A silently-dead cron becomes visible.
--   2. platform_invoices tax columns — PPN (Indonesian VAT) on the platform's own
--      subscription invoices to tenants: tax base (amount) + rate + tax amount +
--      an issued Faktur Pajak number. Mirrors the tenant-side tax_invoices (mig 059).
--   (The ops/alert feed reads existing domain_events — no new table needed.)

BEGIN;

-- ── 1. Background-job heartbeats ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_jobs (
  job_key        VARCHAR(64) PRIMARY KEY,             -- stable id, e.g. 'platform-billing'
  label          VARCHAR(128) NOT NULL,
  last_run_at    TIMESTAMPTZ,
  last_status    VARCHAR(12) NOT NULL DEFAULT 'unknown'
                 CHECK (last_status IN ('ok','error','running','unknown')),
  last_detail    TEXT,
  last_duration_ms INTEGER,
  interval_ms    BIGINT,                              -- expected cadence; drives the stale check
  run_count      BIGINT NOT NULL DEFAULT 0,
  error_count    BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Platform-invoice PPN (Faktur Pajak) ───────────────────────────────────
-- amount = tax base (DPP). tax_amount = amount * tax_rate. payable = amount + tax_amount.
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS tax_rate      NUMERIC(5,4) NOT NULL DEFAULT 0;   -- e.g. 0.1100
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS tax_amount    DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS faktur_number VARCHAR(40);
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS faktur_issued_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_invoice_faktur
  ON platform_invoices(faktur_number) WHERE faktur_number IS NOT NULL;

COMMIT;
