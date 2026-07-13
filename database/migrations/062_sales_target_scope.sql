-- Migration: 062_sales_target_scope
-- Description: Make the overall (tenant-wide) sales target upsertable and disjoint
--   from per-branch targets. `sales_targets.outlet_id` was already nullable
--   (NULL = overall target, set = branch target), but the existing
--   UNIQUE (tenant_id, outlet_id, period) does NOT dedupe the overall row because
--   Postgres treats NULLs as distinct — so `ON CONFLICT` never fired for it and
--   duplicate overall targets could accumulate. Add two partial unique indexes:
--   one for the overall row (one per tenant+period) and one for branch rows
--   (matches the old constraint, kept for an explicit conflict target). Also
--   de-duplicate any pre-existing overall rows, keeping the most recent.
-- Created at: 2026-07-12

BEGIN;

-- Collapse any duplicate overall rows down to the newest per tenant+period.
DELETE FROM sales_targets a
USING sales_targets b
WHERE a.outlet_id IS NULL AND b.outlet_id IS NULL
  AND a.tenant_id = b.tenant_id AND a.period = b.period
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_targets_overall
  ON sales_targets(tenant_id, period) WHERE outlet_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_targets_branch
  ON sales_targets(tenant_id, outlet_id, period) WHERE outlet_id IS NOT NULL;

COMMIT;
