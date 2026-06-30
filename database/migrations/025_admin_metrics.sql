-- 025_admin_metrics.sql
-- Support the platform admin dashboard + multi-level monitoring.
--   • agent_invocations.outlet_id → attribute AI/LLM usage to a branch when known
--     (global = all rows, per-tenant = by tenant_id, per-branch = by outlet_id).
--   • Indexes for the cross-tenant aggregate queries the admin overview runs.

ALTER TABLE agent_invocations ADD COLUMN IF NOT EXISTS outlet_id UUID;

CREATE INDEX IF NOT EXISTS idx_agent_invocations_created   ON agent_invocations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_invocations_tenant_ts ON agent_invocations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_invocations_outlet    ON agent_invocations (outlet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_outlet_created ON orders (outlet_id, created_at DESC);
