-- Migration: 056_commission
-- Description: Per-job staff commission + tips. There was no commission concept;
--   orders.salesperson_name was dead free-text with no link to employees. This adds:
--     * orders.salesperson_employee_id — links a sale to the employee who earned it
--       (set at POS checkout via a staff picker).
--     * commission_accruals — one accrual per order (or order line) per employee,
--       stamped with the payroll period (YYYY-MM) and a snapshot of the rule that
--       produced it. On payroll generation the period's `accrued` rows are rolled
--       up into a single payroll_adjustments (type='bonus') row per employee and
--       flipped to `applied` (reversible when a draft run is regenerated). Voids /
--       refunds flip matching accruals to `reversed`.
--   Commission rules + the enable toggle live in tenants.settings.commission
--   (default OFF) — no schema needed for config.
-- Created at: 2026-07-12

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS salesperson_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS commission_accruals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id             UUID REFERENCES outlets(id) ON DELETE SET NULL,
  order_id              UUID REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id         UUID REFERENCES order_items(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period                VARCHAR(7) NOT NULL,        -- YYYY-MM payroll period
  type                  VARCHAR(14) NOT NULL DEFAULT 'commission'
                          CHECK (type IN ('commission', 'tip', 'monthly_bonus')),
  basis                 JSONB NOT NULL DEFAULT '{}',-- rule snapshot + computed inputs
  amount                DECIMAL(14,2) NOT NULL,
  status                VARCHAR(10) NOT NULL DEFAULT 'accrued'
                          CHECK (status IN ('accrued', 'applied', 'reversed')),
  applied_adjustment_id UUID REFERENCES payroll_adjustments(id) ON DELETE SET NULL,
  applied_run_id        UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_period ON commission_accruals(tenant_id, period, employee_id);
CREATE INDEX IF NOT EXISTS idx_commission_order ON commission_accruals(order_id);
-- Idempotency: at most one accrual per (order line, employee, type). order_item_id
-- NULL (order-grain accruals) are treated as distinct by Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_line
  ON commission_accruals(order_item_id, employee_id, type)
  WHERE order_item_id IS NOT NULL;

COMMIT;
