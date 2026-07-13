-- Migration: 051_finance_hr_setup
-- Description: Zero-config Finance/HR setup for small teams.
--   1. tenant_finance_settings — per-tenant defaults so Finance & Payroll "just
--      run": payroll working-days + pay-day, an optional PPN tax rate, and opt-in
--      automation flags (auto-run payroll on pay-day, auto-close the prior month).
--      Captured during onboarding; the payroll + automation code reads them.
--   2. Tax Payable account (2300) backfilled for existing charts so sale postings
--      can split PPN out of revenue when tax is enabled.
-- Created at: 2026-07-12  (047/048 = accounting; 049/050 taken by parallel work → this is 051)

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_finance_settings (
  tenant_id               UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  payroll_working_days    INT NOT NULL DEFAULT 26 CHECK (payroll_working_days BETWEEN 1 AND 31),
  payroll_pay_day         INT NOT NULL DEFAULT 25 CHECK (payroll_pay_day BETWEEN 1 AND 28),
  auto_run_payroll        BOOLEAN NOT NULL DEFAULT false,
  auto_close_books        BOOLEAN NOT NULL DEFAULT false,
  tax_enabled             BOOLEAN NOT NULL DEFAULT false,
  tax_rate                NUMERIC(5,2) NOT NULL DEFAULT 11,   -- PPN %
  opening_balances_posted BOOLEAN NOT NULL DEFAULT false,
  provisioned_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tax Payable (PPN collected on sales, owed to the tax office) for existing charts.
INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance, is_system)
SELECT DISTINCT tenant_id, '2300', 'Tax Payable (PPN)', 'liability', 'credit', true
FROM chart_of_accounts
ON CONFLICT (tenant_id, code) DO NOTHING;

COMMIT;
