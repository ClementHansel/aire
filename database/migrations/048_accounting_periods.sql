-- Migration: 048_accounting_periods
-- Description: Two additions that make the ledger production-complete.
--   1. accounting_periods — per-tenant monthly open/close. A period is OPEN by
--      default (no row = open); closing it inserts a row with status='closed'.
--      The accounting service refuses to post any journal entry dated in a closed
--      period, so a reconciled/closed month can't be silently changed. Managed
--      from Settings (per tenant).
--   2. Backfill the two inter-branch P&L accounts used by settlement postings
--      (4800 Inter-branch Income, 6300 Inter-branch Charge) for every tenant that
--      already has a chart of accounts, so settlement auto-posting resolves them.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS accounting_periods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period     VARCHAR(7) NOT NULL,                 -- YYYY-MM
  status     VARCHAR(8) NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
  closed_at  TIMESTAMPTZ,
  closed_by  UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period)
);
CREATE INDEX IF NOT EXISTS idx_acct_periods_tenant ON accounting_periods (tenant_id, period);

-- Backfill inter-branch settlement accounts for existing tenants' charts.
INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance, is_system)
SELECT DISTINCT tenant_id, '4800', 'Inter-branch Income', 'revenue', 'credit', true
FROM chart_of_accounts
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance, is_system)
SELECT DISTINCT tenant_id, '6300', 'Inter-branch Charge', 'expense', 'debit', true
FROM chart_of_accounts
ON CONFLICT (tenant_id, code) DO NOTHING;

COMMIT;
