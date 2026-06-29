-- Migration: 001_initial_schema
-- Description: Create all initial tables for AIRE Operations Platform
-- Created at: 2025-01-01

BEGIN;

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- =============================================================================
-- TENANT HIERARCHY
-- =============================================================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan VARCHAR(50) DEFAULT 'standard',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  agent_id VARCHAR(100) UNIQUE NOT NULL,
  address TEXT,
  timezone VARCHAR(50) DEFAULT 'Asia/Jakarta',
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('platform_super_admin', 'tenant_owner', 'outlet_admin', 'cashier')),
  admin_pin_hash VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CUSTOMERS & ORDERS
-- =============================================================================

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  phone_normalized VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, phone_normalized)
);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('car_wash', 'product', 'add_on')),
  price DECIMAL(12,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_main_service BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Membership plans (defined before orders because orders reference memberships)
CREATE TABLE membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  duration_months INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 1,
  max_plates INTEGER NOT NULL DEFAULT 3,
  price DECIMAL(12,2) NOT NULL,
  outlet_ids UUID[],
  free_service_ids UUID[],
  discounted_services JSONB DEFAULT '[]',
  whatsapp_welcome_enabled BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'pending', 'cancelled')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  uses_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL,
  order_id UUID,  -- forward reference, will add FK after orders table
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  operator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  order_number VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'paid', 'confirmed', 'completed', 'cancelled')),
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  license_plate VARCHAR(20),
  vehicle_brand VARCHAR(100),
  vehicle_model VARCHAR(100),
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  service_charge DECIMAL(12,2) DEFAULT 0,
  tax DECIMAL(12,2) DEFAULT 0,
  voucher_discount DECIMAL(12,2) DEFAULT 0,
  promo_discount DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20),
  payment_reference VARCHAR(100),
  amount_received DECIMAL(12,2),
  change_amount DECIMAL(12,2),
  note TEXT,
  membership_id UUID REFERENCES memberships(id),
  void_reason TEXT,
  void_approved_by UUID REFERENCES users(id),
  void_pin_used BOOLEAN DEFAULT false,
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add forward FK from memberships to orders
ALTER TABLE memberships ADD CONSTRAINT fk_memberships_order
  FOREIGN KEY (order_id) REFERENCES orders(id);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL,
  is_member_pricing BOOLEAN DEFAULT false,
  membership_id UUID REFERENCES memberships(id),
  member_discount_type VARCHAR(20),
  member_discount_value DECIMAL(5,2),
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE order_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tag VARCHAR(30) NOT NULL CHECK (tag IN (
    'regular', 'member', 'voucher', 'new_member', 'renewal', 'buy_voucher_pack'
  )),
  UNIQUE(order_id, tag)
);

-- =============================================================================
-- MEMBERSHIP TRACKING
-- =============================================================================

CREATE TABLE membership_plates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  plate VARCHAR(20) NOT NULL,
  plate_normalized VARCHAR(20) NOT NULL,
  brand VARCHAR(100),
  model VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE membership_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  plate_normalized VARCHAR(20) NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed BOOLEAN DEFAULT false,
  reversed_at TIMESTAMPTZ
);

-- =============================================================================
-- VOUCHER SYSTEM
-- =============================================================================

CREATE TABLE voucher_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('fixed', 'percentage', 'service_pack')),
  value DECIMAL(12,2) NOT NULL,
  max_uses INTEGER NOT NULL,
  start_date DATE,
  expiry_date DATE,
  outlet_ids UUID[],
  brand_scope VARCHAR(100)[],
  service_ids UUID[],
  min_order_amount DECIMAL(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE voucher_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  template_id UUID NOT NULL REFERENCES voucher_templates(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id),
  parent_code_hash VARCHAR(255) NOT NULL,
  parent_code_prefix VARCHAR(30) NOT NULL,
  total_uses INTEGER NOT NULL,
  uses_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fully_redeemed', 'expired', 'cancelled')),
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE voucher_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES voucher_packs(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL UNIQUE,
  code_index INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'expired', 'cancelled')),
  redeemed_at TIMESTAMPTZ,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CAMPAIGN SYSTEM
-- =============================================================================

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  bonus_template_id UUID NOT NULL REFERENCES voucher_templates(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  cap INTEGER,
  per_customer_limit INTEGER DEFAULT 1,
  grants_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE campaign_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  voucher_pack_id UUID NOT NULL REFERENCES voucher_packs(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES orders(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- IOT & BAY MANAGEMENT
-- =============================================================================

CREATE TABLE bays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'maintenance')),
  controller_id VARCHAR(100),
  current_order_id UUID REFERENCES orders(id),
  sensor_data JSONB DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alpr_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  camera_id VARCHAR(100) NOT NULL,
  detected_text VARCHAR(20) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  confirmed_plate VARCHAR(20),
  crop_image_path VARCHAR(500),
  order_id UUID REFERENCES orders(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- QUEUE MANAGEMENT
-- =============================================================================

CREATE TABLE queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  bay_id UUID REFERENCES bays(id),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'in_progress', 'completed')),
  estimated_start TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- EMPLOYEE MANAGEMENT
-- =============================================================================

CREATE TABLE employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- AUDIT LOGGING
-- =============================================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  outlet_id UUID REFERENCES outlets(id),
  user_id UUID REFERENCES users(id),
  operation VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  before_value JSONB,
  after_value JSONB,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
