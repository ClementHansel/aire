-- 079_promo_eligibility.sql
-- Promotion eligibility + stacking controls.
--
-- Fixes the "checkout auto-applies & stacks every active promo" bug: a 55.000 sale
-- became 19.000 because "Weekday 20% Off" (-11.000) AND a member-only "Member Bonus
-- Rp25.000" (-25.000) both applied to a NON-member order with no cashier choice.
--
-- After this migration promotions carry eligibility flags; the checkout only applies
-- promos the cashier explicitly selects, gated server-side by these rules.

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS member_only  BOOLEAN         NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stackable    BOOLEAN         NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_purchase NUMERIC(12,2)   NOT NULL DEFAULT 0;

-- Backfill: any promo that reads as member-targeted becomes member-only, so it can
-- never again apply to a walk-in / non-member order.
UPDATE promotions
   SET member_only = true
 WHERE (name ILIKE '%member%' OR description ILIKE '%member%')
   AND member_only = false;

COMMENT ON COLUMN promotions.member_only  IS 'Promo only applies when the order has an active membership.';
COMMENT ON COLUMN promotions.stackable    IS 'Promo may combine with other stackable promos; false = applies alone.';
COMMENT ON COLUMN promotions.min_purchase IS 'Minimum pre-promo subtotal required for the promo to be eligible.';
