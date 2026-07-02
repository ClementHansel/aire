-- 028_employee_user_link.sql
-- Bridge HR employees ↔ login accounts so the work schedule can drive branch
-- scoping (POS follows today's scheduled branch; management scopes to the set of
-- branches an employee is assigned to). Nullable: not every employee has a login,
-- and not every user is an HR employee (owners/super-admins aren't).
-- Idempotent.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- A login account maps to at most one employee within a tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_user
  ON employees(tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);
