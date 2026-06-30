-- =============================================================================
-- Migration 007: AI Agent platform
--   - Backfills agent tables that were only ever mocked in tests
--   - Adds the domain event store (event bus persistence + AI data feed)
--   - Adds agent invocation metrics (monitoring)
--   - Adds conversational chat sessions + messages
-- =============================================================================

-- ── Agent proposals (approval queue) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS action_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  ai_reasoning TEXT,
  confidence_score DECIMAL(4,3) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);
CREATE INDEX IF NOT EXISTS idx_action_proposals_tenant_status
  ON action_proposals(tenant_id, status, created_at DESC);

-- ── Scheduled analysis runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  metrics_reviewed TEXT[],
  insights_found INTEGER NOT NULL DEFAULT 0,
  actions_proposed INTEGER NOT NULL DEFAULT 0,
  actions_executed INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error_details TEXT
);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_tenant
  ON scheduled_analysis_runs(tenant_id, start_time DESC);

-- ── Domain event store (the AI's data backbone + monitoring source) ─────────
CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  outlet_id UUID,
  type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  actor VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_created
  ON domain_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_type_created
  ON domain_events(type, created_at DESC);

-- ── Agent invocations (monitoring: every tool / llm / chat call) ────────────
CREATE TABLE IF NOT EXISTS agent_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  kind VARCHAR(20) NOT NULL,          -- 'tool' | 'llm' | 'chat' | 'analysis'
  name VARCHAR(120) NOT NULL,         -- tool name or model name
  status VARCHAR(20) NOT NULL,        -- 'success' | 'error'
  duration_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_invocations_tenant_created
  ON agent_invocations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_invocations_kind
  ON agent_invocations(kind, created_at DESC);

-- ── Conversational chat ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID,
  title VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant
  ON agent_chat_sessions(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,          -- 'user' | 'assistant' | 'tool' | 'system'
  content TEXT,
  tool_name VARCHAR(120),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON agent_chat_messages(session_id, created_at);
