-- =============================================================================
-- Migration 010: HR & Payroll
--   Schedules, clock in/out, holidays, paid/unpaid leave, bonus/deduction/
--   advance adjustments, loans + repayments, payroll runs + payslips.
-- =============================================================================

-- Employee work schedule (roster) — one entry per employee per day.
CREATE TABLE IF NOT EXISTS employee_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
  work_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_emp_schedules_tenant_date ON employee_schedules(tenant_id, work_date);

-- Attendance: add worked-hours tracking for clock in/out.
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(6,2);
-- one attendance row per employee per day (clock in then clock out)
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_emp_day ON attendance_records(employee_id, work_date);

-- Leave: distinguish paid vs unpaid (drives payroll deductions).
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT true;

-- Public / company holidays.
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, holiday_date)
);

-- Payroll adjustments: bonus (+), deduction (-), advance (- recovered).
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type VARCHAR(12) NOT NULL CHECK (type IN ('bonus', 'deduction', 'advance')),
  amount DECIMAL(14,2) NOT NULL,
  reason TEXT,
  effective_period VARCHAR(7) NOT NULL,            -- YYYY-MM payroll period
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied')),
  applied_run_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_period ON payroll_adjustments(tenant_id, effective_period, status);

-- Employee loans + repayments.
CREATE TABLE IF NOT EXISTS employee_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  principal DECIMAL(14,2) NOT NULL,
  balance DECIMAL(14,2) NOT NULL,
  monthly_installment DECIMAL(14,2) NOT NULL,
  reason TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'cancelled')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_loans_tenant ON employee_loans(tenant_id, status);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
  amount DECIMAL(14,2) NOT NULL,
  period VARCHAR(7),
  method VARCHAR(10) NOT NULL DEFAULT 'payroll' CHECK (method IN ('payroll', 'manual')),
  run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON loan_repayments(loan_id);

-- Payroll runs + payslips.
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period VARCHAR(7) NOT NULL,                      -- YYYY-MM
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  working_days INTEGER NOT NULL DEFAULT 26,
  employee_count INTEGER NOT NULL DEFAULT 0,
  total_gross DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net DECIMAL(14,2) NOT NULL DEFAULT 0,
  generated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant ON payroll_runs(tenant_id, period);

CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_name VARCHAR(255),
  base_salary DECIMAL(14,2) NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  days_worked INTEGER NOT NULL DEFAULT 0,
  unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
  bonus_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  deduction_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  advance_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  loan_repayment_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  unpaid_leave_deduction DECIMAL(14,2) NOT NULL DEFAULT 0,
  gross_pay DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_pay DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(payroll_run_id);
