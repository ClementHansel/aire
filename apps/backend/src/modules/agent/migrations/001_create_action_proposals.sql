-- Migration: Create action_proposals table
-- Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6

CREATE TABLE IF NOT EXISTS action_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  action_type VARCHAR(100) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  ai_reasoning TEXT NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant_status ON action_proposals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON action_proposals(created_at) WHERE status = 'pending';
