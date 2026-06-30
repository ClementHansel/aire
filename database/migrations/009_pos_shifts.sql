-- =============================================================================
-- Migration 009: POS shifts (register open/close), petty cash, shift issues
-- Tracks per-shift activity, attendance (operator + open/close times), cash
-- reconciliation (opening float vs counted), and issues. Orders are linked to
-- the open shift so sales can be reported shift-by-shift.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pos_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_name VARCHAR(255),
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Populated at close:
  closing_counted DECIMAL(14,2),
  expected_cash DECIMAL(14,2),
  variance DECIMAL(14,2),
  cash_sales DECIMAL(14,2),
  non_cash_sales DECIMAL(14,2),
  total_sales DECIMAL(14,2),
  order_count INTEGER,
  notes TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_tenant ON pos_shifts(tenant_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_open ON pos_shifts(operator_id, status);

CREATE TABLE IF NOT EXISTS petty_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  type VARCHAR(4) NOT NULL CHECK (type IN ('in', 'out')),
  amount DECIMAL(14,2) NOT NULL,
  category VARCHAR(60),
  reason TEXT,
  actor UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_shift ON petty_cash_movements(shift_id, created_at);

CREATE TABLE IF NOT EXISTS shift_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  severity VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
  description TEXT NOT NULL,
  reported_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shift_issues_shift ON shift_issues(shift_id, created_at);

-- Link orders to the shift they were rung up in.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES pos_shifts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id);
