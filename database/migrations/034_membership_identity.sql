-- Migration: 034_membership_identity
-- Description: Membership identity — a 12-char alphanumeric (base-36) number
--   TTTTTT(tenant, global) + BB(branch, per tenant) + CCCC(customer, per branch).
--   Codes are assigned lazily by MembershipIdentityService at membership issue.
--   Columns are nullable + partial-unique so existing rows don't collide.
-- Created at: 2026-07-10

BEGIN;

ALTER TABLE tenants   ADD COLUMN IF NOT EXISTS tenant_code CHAR(6);
ALTER TABLE outlets   ADD COLUMN IF NOT EXISTS branch_code CHAR(2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code CHAR(4);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registered_outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS membership_number CHAR(12);

-- tenant_code globally unique; branch_code unique per tenant; customer_code unique
-- per (tenant, registered branch); membership_number globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_tenant_code
  ON tenants(tenant_code) WHERE tenant_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlets_branch_code
  ON outlets(tenant_id, branch_code) WHERE branch_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_customer_code
  ON customers(tenant_id, registered_outlet_id, customer_code) WHERE customer_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_membership_number
  ON customers(membership_number) WHERE membership_number IS NOT NULL;

COMMIT;
