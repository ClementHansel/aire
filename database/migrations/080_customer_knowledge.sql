-- 080_customer_knowledge.sql
-- Tenant-managed AI knowledge: what the customer-facing agent (Irene) may share.
--
--  * agent_configs.customer_knowledge  — per-CATEGORY visibility flags (JSONB).
--    Missing/true = visible (backward compatible with today's always-on behavior);
--    only an explicit false hides a category from customers.
--  * <entity>.customer_visible          — per-ITEM override; a hidden item is never
--    shared even when its category is on.
--  * outlets.maps_url                   — Google Maps link surfaced by get_branch_info.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS customer_knowledge JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE outlets
  ADD COLUMN IF NOT EXISTS maps_url        TEXT,
  ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT true;

-- Seed the full set of category flags (all visible) on existing configs so the
-- management UI renders every toggle in its default (on) state.
UPDATE agent_configs
   SET customer_knowledge = jsonb_build_object(
        'service_prices',   true,
        'promotions',       true,
        'membership_plans', true,
        'vouchers',         true,
        'branches',         true,
        'opening_hours',    true,
        'branch_contact',   true
   )
 WHERE customer_knowledge = '{}'::jsonb;

COMMENT ON COLUMN agent_configs.customer_knowledge IS 'Per-category flags for what the customer AI may reveal (service_prices/promotions/membership_plans/vouchers/branches/opening_hours/branch_contact). Missing key = visible.';
COMMENT ON COLUMN outlets.customer_visible  IS 'Whether this branch is shown to customers by the AI.';
COMMENT ON COLUMN services.customer_visible IS 'Whether this service/price is shown to customers by the AI.';
