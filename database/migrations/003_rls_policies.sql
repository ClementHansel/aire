-- Migration: 003_rls_policies
-- Description: Row Level Security policies for tenant isolation and outlet scoping
-- Created at: 2025-01-01

BEGIN;

-- =============================================================================
-- CREATE APPLICATION ROLE
-- The app connects with this role; RLS policies filter data based on session vars
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

-- Grant basic permissions to app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- =============================================================================
-- ENABLE RLS ON ALL TENANT-SCOPED TABLES
-- =============================================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bays ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpr_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TENANT ISOLATION POLICIES
-- Base policy: every table with tenant_id is filtered by app.tenant_id
-- =============================================================================

-- Tenants table: users can only see their own tenant
CREATE POLICY tenant_isolation_tenants ON tenants
  FOR ALL
  USING (id = current_setting('app.tenant_id', true)::uuid);

-- Outlets: tenant isolation
CREATE POLICY tenant_isolation_outlets ON outlets
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Users: tenant isolation (platform_super_admin has NULL tenant_id)
CREATE POLICY tenant_isolation_users ON users
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (tenant_id IS NULL AND current_setting('app.role', true) = 'platform_super_admin')
  );

-- Customers: cross-outlet within tenant (no outlet scoping)
CREATE POLICY tenant_isolation_customers ON customers
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Orders: tenant isolation
CREATE POLICY tenant_isolation_orders ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Order items: via order's tenant (join-based check using subquery)
CREATE POLICY tenant_isolation_order_items ON order_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- Order tags: via order's tenant
CREATE POLICY tenant_isolation_order_tags ON order_tags
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_tags.order_id
      AND orders.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- Services: tenant isolation
CREATE POLICY tenant_isolation_services ON services
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Membership plans: tenant isolation
CREATE POLICY tenant_isolation_membership_plans ON membership_plans
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Memberships: cross-outlet within tenant (no outlet scoping)
CREATE POLICY tenant_isolation_memberships ON memberships
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Membership plates: via membership's tenant
CREATE POLICY tenant_isolation_membership_plates ON membership_plates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.id = membership_plates.membership_id
      AND memberships.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- Membership usages: via membership's tenant
CREATE POLICY tenant_isolation_membership_usages ON membership_usages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.id = membership_usages.membership_id
      AND memberships.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- Voucher templates: tenant isolation
CREATE POLICY tenant_isolation_voucher_templates ON voucher_templates
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Voucher packs: tenant isolation
CREATE POLICY tenant_isolation_voucher_packs ON voucher_packs
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Voucher codes: via pack's tenant
CREATE POLICY tenant_isolation_voucher_codes ON voucher_codes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM voucher_packs
      WHERE voucher_packs.id = voucher_codes.pack_id
      AND voucher_packs.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- Campaigns: tenant isolation
CREATE POLICY tenant_isolation_campaigns ON campaigns
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Campaign grants: via campaign's tenant
CREATE POLICY tenant_isolation_campaign_grants ON campaign_grants
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_grants.campaign_id
      AND campaigns.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- Bays: tenant isolation
CREATE POLICY tenant_isolation_bays ON bays
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ALPR detections: tenant isolation
CREATE POLICY tenant_isolation_alpr_detections ON alpr_detections
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Queue entries: tenant isolation
CREATE POLICY tenant_isolation_queue_entries ON queue_entries
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Employee shifts: tenant isolation
CREATE POLICY tenant_isolation_employee_shifts ON employee_shifts
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Audit logs: tenant isolation
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =============================================================================
-- OUTLET SCOPING POLICIES
-- Restricts outlet-scoped data for cashier/outlet_admin roles
-- tenant_owner and platform_super_admin see all outlets within tenant
-- =============================================================================

-- Outlets: outlet scoping
CREATE POLICY outlet_scope_outlets ON outlets
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR id = current_setting('app.outlet_id', true)::uuid
  );

-- Orders: outlet scoping
CREATE POLICY outlet_scope_orders ON orders
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- Services: outlet scoping (NULL outlet_id = visible to all)
CREATE POLICY outlet_scope_services ON services
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id IS NULL
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- Bays: outlet scoping
CREATE POLICY outlet_scope_bays ON bays
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- ALPR detections: outlet scoping
CREATE POLICY outlet_scope_alpr_detections ON alpr_detections
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- Queue entries: outlet scoping
CREATE POLICY outlet_scope_queue_entries ON queue_entries
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- Employee shifts: outlet scoping
CREATE POLICY outlet_scope_employee_shifts ON employee_shifts
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- Audit logs: outlet scoping (NULL outlet_id = visible to all with tenant access)
CREATE POLICY outlet_scope_audit_logs ON audit_logs
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('tenant_owner', 'platform_super_admin')
    OR outlet_id IS NULL
    OR outlet_id = current_setting('app.outlet_id', true)::uuid
  );

-- =============================================================================
-- BYPASS POLICIES FOR SUPERUSER/MIGRATION ROLE
-- The database owner (migration role) bypasses RLS automatically.
-- For explicit clarity, we ensure RLS is not enforced on the table owner.
-- =============================================================================

-- Note: By default, table owners bypass RLS. The 'app_user' role defined above
-- will have RLS enforced. The migration/admin role (database owner) will always
-- bypass RLS for administrative tasks.

COMMIT;
