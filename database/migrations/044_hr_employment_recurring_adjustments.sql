-- Migration: 044_hr_employment_recurring_adjustments
-- Description: Two HR/payroll upgrades.
--   1. employees.employment_type — 'permanent' vs 'contract' (defaults to
--      'permanent' so existing staff are unaffected). Replaces the "login
--      account" column in the HR list as a more operationally important field.
--   2. Recurring payroll adjustments. Until now a bonus/deduction/advance applied
--      to exactly one month. A recurring adjustment (recurring = true,
--      total_periods = N) auto-applies its amount for N consecutive payroll runs
--      starting at effective_period — mirroring how a loan installment repeats
--      each run until paid up. Each application is recorded in
--      payroll_adjustment_applications (one row per run it hit), so regenerating /
--      reversing a draft run can undo just that run's slice, exactly like
--      loan_repayments. The parent adjustment's status becomes 'active' while it
--      is still recurring and 'completed' once all N periods have applied.
-- Created at: 2026-07-12

BEGIN;

-- 1. Employment type ---------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employment_type VARCHAR(12) NOT NULL DEFAULT 'permanent'
    CHECK (employment_type IN ('permanent', 'contract'));

-- 2. Recurring adjustments ---------------------------------------------------
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS recurring BOOLEAN NOT NULL DEFAULT false;

-- Number of monthly periods a recurring adjustment repeats for (NULL = one-shot).
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS total_periods INTEGER;

-- Widen the status set: one-shots use pending -> applied (unchanged); recurring
-- parents use active -> completed. Drop the inline CHECK from migration 010 and
-- re-add the extended one.
ALTER TABLE payroll_adjustments
  DROP CONSTRAINT IF EXISTS payroll_adjustments_status_check;
ALTER TABLE payroll_adjustments
  ADD CONSTRAINT payroll_adjustments_status_check
    CHECK (status IN ('pending', 'applied', 'active', 'completed', 'cancelled'));

-- Per-run application ledger for recurring adjustments (mirrors loan_repayments).
CREATE TABLE IF NOT EXISTS payroll_adjustment_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  adjustment_id UUID NOT NULL REFERENCES payroll_adjustments(id) ON DELETE CASCADE,
  run_id        UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  period        VARCHAR(7) NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One application per adjustment per period (idempotency guard).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_adj_app_period
  ON payroll_adjustment_applications (adjustment_id, period);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_app_run
  ON payroll_adjustment_applications (run_id);

COMMIT;
