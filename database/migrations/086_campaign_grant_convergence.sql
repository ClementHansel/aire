-- Migration: 086_campaign_grant_convergence
-- Description: AIRIN-138 + AIRIN-102.
--
--   AIRIN-138 ("Bonus voucher yang sudah di set di campaign untuk pembelian
--   membership, tidak ada di issued voucher"): campaign grants wrote into
--   voucher_packs/voucher_codes (hashed parent/child codes, never displayed
--   again after the one-time WhatsApp send), while the dashboard's "Issued
--   Vouchers" tab reads voucher_books/voucher_tickets (plaintext, always
--   listable/redeemable-lookup). A granted code that failed WhatsApp delivery
--   was unrecoverable, and even a delivered one never showed up in Issued
--   Vouchers. CampaignGrantService is being switched to grant onto
--   voucher_books/voucher_tickets instead, so campaign_grants needs a
--   voucher_book_id column alongside the existing voucher_pack_id (kept, for
--   historical rows already pointing at a pack — never rewritten here).
--
--   AIRIN-102 ("Tidak ada fitur untuk case pembelian voucher cuci 10x bonus
--   spray wax 3x"): campaigns can currently only trigger off a membership
--   plan purchase (plan_id NOT NULL). This adds a trigger discriminator so a
--   campaign can instead trigger off a voucher-pack (template) purchase —
--   plan_id becomes nullable, trigger_template_id (a voucher_templates row)
--   is added as the alternate trigger, and a CHECK enforces exactly one
--   trigger is configured per campaign, matching trigger_type.
-- Created at: 2026-07-29

BEGIN;

-- ── AIRIN-138: campaign_grants can point at a voucher_book instead of a pack ──
ALTER TABLE campaign_grants
  ADD COLUMN IF NOT EXISTS voucher_book_id UUID REFERENCES voucher_books(id) ON DELETE RESTRICT;

-- Existing rows all have voucher_pack_id set; only allow it to go unset going
-- forward (new grants set voucher_book_id instead).
ALTER TABLE campaign_grants ALTER COLUMN voucher_pack_id DROP NOT NULL;

ALTER TABLE campaign_grants DROP CONSTRAINT IF EXISTS campaign_grants_exactly_one_target;
ALTER TABLE campaign_grants
  ADD CONSTRAINT campaign_grants_exactly_one_target
  CHECK (num_nonnulls(voucher_pack_id, voucher_book_id) = 1);

COMMENT ON COLUMN campaign_grants.voucher_pack_id IS 'Set for grants issued before 2026-07-29 (hashed pack/code model). New grants use voucher_book_id instead.';
COMMENT ON COLUMN campaign_grants.voucher_book_id IS 'The plaintext-code voucher_books row this grant issued — same model the dashboard Issued Vouchers tab reads and POS resolveDigitalVouchers redeems.';

-- ── AIRIN-102: campaigns can trigger on a voucher-pack purchase, not just a plan ──
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(20) NOT NULL DEFAULT 'membership_plan'
    CHECK (trigger_type IN ('membership_plan', 'voucher_pack'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS trigger_template_id UUID REFERENCES voucher_templates(id) ON DELETE RESTRICT;

ALTER TABLE campaigns ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_trigger_matches_type;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_trigger_matches_type
  CHECK (
    (trigger_type = 'membership_plan' AND plan_id IS NOT NULL AND trigger_template_id IS NULL)
    OR
    (trigger_type = 'voucher_pack' AND trigger_template_id IS NOT NULL AND plan_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_campaigns_trigger_template ON campaigns(tenant_id, trigger_template_id) WHERE trigger_template_id IS NOT NULL;

COMMENT ON COLUMN campaigns.trigger_type IS 'What purchase fires this campaign: membership_plan (plan_id) or voucher_pack (trigger_template_id).';
COMMENT ON COLUMN campaigns.trigger_template_id IS 'voucher_templates row whose purchase (VoucherPackIssued) triggers this campaign. Set only when trigger_type = voucher_pack.';

COMMIT;
