-- Migration: 013_commerce
-- Description: Phase 2 commerce — membership home-branch + inter-branch settlement,
--   shareable digital voucher tickets (BRANCH-MMYYYY-NNNNNN), and a promotion engine.
-- Created at: 2026-06-30

BEGIN;

-- ── Membership: where it was bought (home branch) ───────────────────────────────
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS home_outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL;
-- Per-plan amount the home branch owes the redeeming branch for a cross-branch wash.
ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS settlement_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
-- Where each wash was redeemed (for settlement).
ALTER TABLE membership_usages ADD COLUMN IF NOT EXISTS outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL;

-- ── Inter-branch settlement ledger ──────────────────────────────────────────────
-- One entry per cross-branch membership redemption: the owing (home) branch must
-- pay the serving (redeeming) branch `amount`.
CREATE TABLE IF NOT EXISTS settlement_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  usage_id UUID REFERENCES membership_usages(id) ON DELETE SET NULL,
  owing_outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,   -- home branch (pays)
  serving_outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT, -- redeeming branch (receives)
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','void')),
  payout_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_entries_tenant ON settlement_entries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_entries_pair ON settlement_entries(owing_outlet_id, serving_outlet_id, status);

-- A payout batch settles a set of pending entries between two branches.
CREATE TABLE IF NOT EXISTS settlement_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owing_outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  serving_outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_payouts_tenant ON settlement_payouts(tenant_id, created_at DESC);

-- ── Shareable digital vouchers (new format BRANCH-MMYYYY-NNNNNN) ──────────────────
-- A "book" is one purchase of N tickets. Tickets carry a plaintext, shareable code.
CREATE TABLE IF NOT EXISTS voucher_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  buyer_name VARCHAR(255),
  buyer_phone VARCHAR(20),
  quantity INTEGER NOT NULL,
  /** what each ticket is worth: a free service, or a fixed/percent discount */
  benefit_type VARCHAR(20) NOT NULL DEFAULT 'service' CHECK (benefit_type IN ('service','fixed','percentage')),
  benefit_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  benefit_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  expiry_date DATE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_books_tenant ON voucher_books(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voucher_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES voucher_books(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  /** plaintext shareable code, e.g. BTR-062026-000123 (unique per tenant) */
  code VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','redeemed','expired','void')),
  redeemed_at TIMESTAMPTZ,
  redeemed_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  redeemed_outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_voucher_tickets_code ON voucher_tickets(tenant_id, code);

-- Per branch + period (MMYYYY) sequence counter for the 6-digit voucher number.
CREATE TABLE IF NOT EXISTS voucher_counters (
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  period CHAR(6) NOT NULL,           -- MMYYYY
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, period)
);

-- ── Promotion engine ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  /** branches this promo applies to; null/empty = all branches */
  outlet_ids UUID[],
  /** trigger: products that qualify; null/empty = any product */
  trigger_service_ids UUID[],
  /** reward kind */
  reward_type VARCHAR(20) NOT NULL CHECK (reward_type IN ('discount_fixed','discount_percentage','free_product','free_voucher','future_discount')),
  reward_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  reward_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  max_quota INTEGER,            -- null = unlimited
  used_quota INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant ON promotions(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS promotion_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promotion_grants_promo ON promotion_grants(promotion_id);

COMMIT;
