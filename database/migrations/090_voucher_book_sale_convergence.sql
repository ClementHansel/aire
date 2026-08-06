-- 090: finish the voucher convergence started in 086 — pack SALES become books too.
--
-- Background (AIRIN-145, second half: "voucher pack nya tidak tampil di issued
-- voucher"). There were two parallel voucher models:
--
--   * voucher_books/voucher_tickets — PLAINTEXT codes. The only model the
--     dashboard "Issued Vouchers" tab reads (listBooks) and the only one a
--     cashier can look up by code.
--   * voucher_packs/voucher_codes — SHA-256 HASHES. Structurally invisible to
--     any dashboard: there is no way to render a code you only stored a hash of.
--
-- 086 moved campaign BONUS grants onto books, which is why a membership bonus
-- shows up (AIRIN-138) while a plain voucher-pack purchase at the POS did not:
-- that path still minted hashed packs. This migration adds the two columns the
-- sale path needs so it can mint books as well:
--
--   * template_id — WHICH pack template the book came from, so Issued Vouchers
--     can name it ("Voucher Cuci 10x") instead of showing a bare benefit type.
--     Also what lets a transaction line say which pack was bought (AIRIN-115).
--   * source      — 'sale' (bought at the POS), 'bonus' (campaign grant), or
--     'adhoc' (the dashboard's own Sell-Voucher form). Needed as the idempotency
--     discriminator: a single order can legitimately own TWO books — the pack the
--     customer bought AND the campaign bonus that purchase triggered — so
--     "already issued for this order?" cannot key on order_id alone.
--
-- Existing rows: pre-090 books were either ad-hoc sales or bonus grants. Bonus
-- grants are identifiable by their campaign_grants.voucher_book_id backlink, so
-- they are labelled precisely; everything else keeps the 'adhoc' default.

ALTER TABLE voucher_books
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES voucher_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'adhoc'
    CHECK (source IN ('sale', 'bonus', 'adhoc'));

COMMENT ON COLUMN voucher_books.template_id IS
  'The voucher_templates row this book was minted from (pack sales + campaign bonuses). NULL for ad-hoc dashboard sales, which describe their benefit inline.';
COMMENT ON COLUMN voucher_books.source IS
  'How the book came to exist: sale = bought at the POS, bonus = campaign grant, adhoc = dashboard Sell Voucher form. Discriminates the two books one order can own.';

-- Backfill: label historical campaign grants via their existing backlink.
-- Guarded because campaign_grants.voucher_book_id arrived in migration 086: a
-- database that has not reached 086 yet has no book-backed grants to label, and
-- an unguarded reference would abort this migration on a bare column error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'campaign_grants' AND column_name = 'voucher_book_id'
  ) THEN
    UPDATE voucher_books b
       SET source = 'bonus'
      FROM campaign_grants g
     WHERE g.voucher_book_id = b.id
       AND b.source <> 'bonus';
  END IF;
END $$;

-- issueForOrder's idempotency probe is (order_id, source) — index it.
CREATE INDEX IF NOT EXISTS idx_voucher_books_order_source
  ON voucher_books(order_id, source) WHERE order_id IS NOT NULL;
