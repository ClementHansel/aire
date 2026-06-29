-- Migration: Create scheduled_analysis_runs table
-- Requirements: 8.2, 8.3, 8.4, 8.5

CREATE TABLE IF NOT EXISTS scheduled_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  metrics_reviewed TEXT[] NOT NULL DEFAULT '{}',
  insights_found INTEGER NOT NULL DEFAULT 0,
  actions_proposed INTEGER NOT NULL DEFAULT 0,
  actions_executed INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error_details TEXT,
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_tenant ON scheduled_analysis_runs(tenant_id, start_time DESC);
