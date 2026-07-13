-- Migration: 002_indexes
-- Description: Create all performance indexes
-- Created at: 2025-01-01

BEGIN;

-- =============================================================================
-- TENANT ISOLATION INDEXES (tenant_id on all tenant-scoped tables)
-- =============================================================================

CREATE INDEX idx_outlets_tenant ON outlets(tenant_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_services_tenant ON services(tenant_id);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_membership_plans_tenant ON membership_plans(tenant_id);
CREATE INDEX idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX idx_voucher_templates_tenant ON voucher_templates(tenant_id);
CREATE INDEX idx_voucher_packs_tenant ON voucher_packs(tenant_id);
CREATE INDEX idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX idx_bays_tenant ON bays(tenant_id);
CREATE INDEX idx_queue_entries_tenant ON queue_entries(tenant_id);
CREATE INDEX idx_employee_shifts_tenant ON employee_shifts(tenant_id);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);

-- =============================================================================
-- OUTLET SCOPING INDEXES
-- =============================================================================

CREATE INDEX idx_outlets_agent_id ON outlets(agent_id);
CREATE INDEX idx_users_outlet ON users(outlet_id);
CREATE INDEX idx_services_outlet ON services(outlet_id);
CREATE INDEX idx_orders_outlet ON orders(outlet_id);
CREATE INDEX idx_bays_outlet ON bays(outlet_id);
CREATE INDEX idx_queue_entries_outlet ON queue_entries(outlet_id);
CREATE INDEX idx_employee_shifts_outlet ON employee_shifts(outlet_id);

-- =============================================================================
-- QUERY-OPTIMIZED COMPOSITE INDEXES
-- =============================================================================

-- Orders: primary query pattern (list by outlet + status + date)
CREATE INDEX idx_orders_tenant_outlet_status ON orders(tenant_id, outlet_id, status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);

-- Customers: phone lookup
CREATE INDEX idx_customers_phone_normalized ON customers(tenant_id, phone_normalized);

-- Membership plates: normalized plate lookup
CREATE INDEX idx_membership_plates_normalized ON membership_plates(plate_normalized);

-- Memberships: customer lookup
CREATE INDEX idx_memberships_customer ON memberships(customer_id, status);

-- Voucher codes: code hash lookup (already UNIQUE, but explicit index)
CREATE INDEX idx_voucher_codes_hash ON voucher_codes(code_hash);

-- Membership usages: usage tracking per membership
CREATE INDEX idx_membership_usages_membership_date ON membership_usages(membership_id, used_at);
CREATE INDEX idx_membership_usages_plate_date ON membership_usages(membership_id, plate_normalized, used_at);

-- Audit logs: tenant + time range queries
CREATE INDEX idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Queue: outlet queue ordering
CREATE INDEX idx_queue_entries_outlet_status ON queue_entries(outlet_id, status, priority DESC);

-- Order items: lookup by order
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Employee shifts: lookup by user and outlet
CREATE INDEX idx_employee_shifts_user ON employee_shifts(user_id, clock_in);

-- Campaign grants: dedup check
CREATE INDEX idx_campaign_grants_campaign_customer ON campaign_grants(campaign_id, customer_id);

-- Voucher packs: customer lookup
CREATE INDEX idx_voucher_packs_customer ON voucher_packs(customer_id);

COMMIT;
