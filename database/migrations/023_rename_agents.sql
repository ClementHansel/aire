-- 023_rename_agents.sql
-- Rename the demo tenant's seeded agents: KADEK → Oline, Zara → Ersa.
-- Safe/no-op on fresh DBs (022 already seeds the new names).

UPDATE agents SET name = 'Oline'
 WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'KADEK';

UPDATE agents SET name = 'Ersa'
 WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND name = 'Zara';
