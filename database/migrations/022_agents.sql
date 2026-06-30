-- 022_agents.sql
-- Multi-agent registry: tenants can define several named AI agents (e.g. a
-- personal assistant + a customer-service agent) that form a simple workflow.
-- This is the data foundation for the Agent Workflow view; live routing builds
-- on the existing agent-config / whatsapp modules.

CREATE TABLE IF NOT EXISTS agents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  role        VARCHAR(40) NOT NULL DEFAULT 'personal_assistant'
                CHECK (role IN ('personal_assistant','customer_service','sales','supervisor')),
  description TEXT,
  prompt      TEXT,
  is_active   BOOLEAN DEFAULT true,
  position    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id, position);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Seed the demo tenant's agent line-up (mirrors the previous system).
INSERT INTO agents (tenant_id, name, role, description, position)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'KADEK', 'personal_assistant', 'Front-line greeter and FAQ assistant', 1),
  ('11111111-1111-1111-1111-111111111111', 'Zara',  'personal_assistant', 'Booking & membership assistant', 2),
  ('11111111-1111-1111-1111-111111111111', 'CS1',   'customer_service',   'Customer service & escalation', 3)
ON CONFLICT DO NOTHING;
