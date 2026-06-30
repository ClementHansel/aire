-- 024_more_agents.sql
-- Add the planned additional agents to the demo tenant's line-up.
-- Idempotent: only inserts agents that don't already exist (by name).

INSERT INTO agents (tenant_id, name, role, description, position)
SELECT v.tenant_id, v.name, v.role, v.description, v.position
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Tirta', 'sales',            'Membership upsell, voucher packs & promotions',                4),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Bayu',  'customer_service', 'Post-service follow-up, complaints & re-wash requests',         5),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Nadia', 'personal_assistant','Queue & status updates and booking reminders',                6),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Reza',  'supervisor',       'Escalation target and daily summary to the owner',             7),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Dimas', 'sales',            'LEAD detailing specialist (coating quotes by size/tier)',      8)
) AS v(tenant_id, name, role, description, position)
WHERE NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.tenant_id = v.tenant_id AND a.name = v.name
);
