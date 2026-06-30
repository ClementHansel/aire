-- Migration: 012_foundation_saas
-- Description: SaaS foundation — branch labels + code, multi-branch user placement,
--   dynamic RBAC roles, per-branch payment methods, product categories & brands,
--   and multi-branch product scoping.
-- Created at: 2026-06-30

BEGIN;

-- ── Branches (outlets): legal-entity label + 3-letter code (for voucher format) ──
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS legal_entity VARCHAR(255);
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS code VARCHAR(8);

-- Backfill a branch code from the name (first 3 alpha chars, uppercased) where missing.
UPDATE outlets
   SET code = UPPER(SUBSTRING(REGEXP_REPLACE(name, '[^A-Za-z]', '', 'g') FROM 1 FOR 3))
 WHERE code IS NULL;

-- ── Multi-branch user placement (one staff → many branches, rolling cashier) ─────
CREATE TABLE IF NOT EXISTS user_outlets (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, outlet_id)
);
CREATE INDEX IF NOT EXISTS idx_user_outlets_outlet ON user_outlets(outlet_id);

-- Backfill: seed the join table from each user's existing single outlet_id.
INSERT INTO user_outlets (user_id, outlet_id)
SELECT id, outlet_id FROM users WHERE outlet_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── Dynamic RBAC: tenant-scoped custom roles with a permission set ───────────────
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  /** base role this custom role maps to for hierarchy (cashier/outlet_admin/tenant_owner) */
  base_role VARCHAR(30) NOT NULL DEFAULT 'cashier'
    CHECK (base_role IN ('platform_super_admin','tenant_owner','outlet_admin','cashier')),
  /** array of permission keys, e.g. ["transactions.read","branches.write"] */
  permissions JSONB NOT NULL DEFAULT '[]',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- Optional custom role assignment on a user (keeps users.role for base hierarchy).
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- ── Payment methods (CRUD per branch, with logo + colour for the POS) ────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** null = available to all branches in the tenant */
  outlet_id UUID REFERENCES outlets(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  /** settlement kind: cash | qris | edc | cc | transfer */
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('cash','qris','edc','cc','transfer')),
  /** which business unit account it settles to (AIRE/LEAD), null = n/a (e.g. cash) */
  business_unit VARCHAR(10) CHECK (business_unit IS NULL OR business_unit IN ('AIRE','LEAD')),
  logo_url TEXT,
  color VARCHAR(20) DEFAULT '#1652F0',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON payment_methods(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_payment_methods_outlet ON payment_methods(outlet_id);

-- ── Brands (AIRE / LEAD, CRUD-able & extensible per tenant) ───────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#1652F0',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_brands_tenant ON brands(tenant_id, is_active);

-- ── Product categories ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_product_categories_tenant ON product_categories(tenant_id, is_active);

-- ── Products: multi-branch scope + category + brand links ────────────────────────
-- Services double as products; add the new dimensions (kept nullable for back-compat).
ALTER TABLE services ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
-- null/empty outlet_ids = available to ALL branches; otherwise the listed branches.
ALTER TABLE services ADD COLUMN IF NOT EXISTS outlet_ids UUID[];

COMMIT;
