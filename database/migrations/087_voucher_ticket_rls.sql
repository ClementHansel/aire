-- Migration: 087_voucher_ticket_rls
-- Description: Close a multi-tenant isolation gap on the shareable-voucher
--   tables. `voucher_books`, `voucher_tickets` and `voucher_counters` have had
--   RLS DISABLED with zero policies since migration 013, while every sibling in
--   the same domain is protected:
--
--     voucher_packs     RLS on, tenant_isolation_voucher_packs
--     voucher_codes     RLS on, tenant_isolation_voucher_codes (via pack)
--     campaign_grants   RLS on, tenant_isolation_campaign_grants (via campaign)
--     orders/customers  RLS on
--     voucher_books     RLS OFF, no policies   ← here
--     voucher_tickets   RLS OFF, no policies   ← here
--     voucher_counters  RLS OFF, no policies   ← here
--
--   Tenant scoping on these three was enforced only by app-layer
--   `WHERE tenant_id = $1`, so a single missing predicate in any current or
--   future query leaked another tenant's vouchers — including redeemable
--   plaintext codes, which is worse than most leaks of this shape.
--
--   Newly urgent rather than merely old: 086 moved campaign bonus-voucher
--   issuance OUT of voucher_packs/voucher_codes (RLS-protected) and INTO
--   voucher_books/voucher_tickets. Without this migration that convergence
--   downgrades the protection on grant data as a side effect.
--
--   Policies mirror the existing pattern exactly — `current_setting('app.tenant_id')`
--   for tables holding tenant_id directly, and an EXISTS join for those that
--   don't (voucher_counters is keyed by outlet, like voucher_codes is by pack).
-- Created at: 2026-07-29

BEGIN;

-- ─── voucher_books ────────────────────────────────────────────────────────────
ALTER TABLE voucher_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_voucher_books ON voucher_books;
CREATE POLICY tenant_isolation_voucher_books ON voucher_books
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- ─── voucher_tickets ──────────────────────────────────────────────────────────
-- Carries tenant_id directly (unlike voucher_codes, which must join its pack),
-- so scope on the column rather than through book_id.
ALTER TABLE voucher_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_voucher_tickets ON voucher_tickets;
CREATE POLICY tenant_isolation_voucher_tickets ON voucher_tickets
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- ─── voucher_counters ─────────────────────────────────────────────────────────
-- Keyed (outlet_id, period) with no tenant_id, so reach the tenant through the
-- outlet — the same EXISTS shape used by tenant_isolation_voucher_codes.
--
-- This table is the per-branch sequence behind BRANCH-MMYYYY-NNNNNN codes. It
-- holds no customer data, but leaving it open let one tenant observe (and via
-- the UPSERT in sellBook, perturb) another tenant's code sequence.
ALTER TABLE voucher_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_voucher_counters ON voucher_counters;
CREATE POLICY tenant_isolation_voucher_counters ON voucher_counters
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM outlets
       WHERE outlets.id = voucher_counters.outlet_id
         AND outlets.tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

COMMIT;
