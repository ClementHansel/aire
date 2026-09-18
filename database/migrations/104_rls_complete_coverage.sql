-- Migration: 104_rls_complete_coverage
-- Description: Make row-level security COMPLETE and give the app a role that
--   RLS actually applies to. Phase 1 of two: this is inert until the backend
--   connects as that role (see docs/DEPLOYMENT.md "Row-level security").
--
--   Why: tenant isolation on this platform is enforced entirely in application
--   code. The database backstop that looks like it exists does not:
--
--     * the app connects as `aire`, which is SUPERUSER and BYPASSRLS, so every
--       policy is skipped;
--     * only 29 of the 100 tenant-owned tables had RLS enabled at all;
--     * nothing in the backend has ever executed `set_config('app.tenant_id',
--       ...)`, so the 35 existing policies have never been exercised even in
--       principle.
--
--   A forgotten `AND tenant_id = $n` is therefore a silent cross-tenant leak
--   with nothing underneath to catch it. That is not hypothetical: the reports
--   leak (July 2026) and the kiosk queue-status leak (2928584) were both
--   exactly this.
--
--   What this migration does:
--     1. Enables RLS and adds the standard tenant policy to EVERY table with a
--        tenant_id column that does not already have a policy. Data-driven on
--        purpose — it discovers the tables from the catalog, so a table added
--        by a later migration is covered by re-running this, and no list of 100
--        names has to be maintained here.
--     2. Leaves hand-written policies alone. `users` and `outlets` have
--        deliberately richer rules (platform-super-admin visibility of
--        tenant-less rows, outlet scoping); clobbering them with the uniform
--        rule would be a regression.
--     3. Creates `aire_app`: LOGIN, NOSUPERUSER, NOBYPASSRLS — a role the
--        policies bind to — with DML on the existing tables and default
--        privileges for tables created later. No password is set here; ops sets
--        it (see DEPLOYMENT.md) so no credential lives in a migration.
--
--   Verified behaviour of this policy shape (measured, not assumed):
--     * app.tenant_id UNSET   -> 0 rows. Fail-closed.
--     * INSERT for another tenant -> "new row violates row-level security".
--     * UPDATE across tenants -> 0 rows affected.
--     * A session-level set_config works without a transaction, and changing it
--       on the same pooled connection re-scopes correctly.
--     * app.tenant_id = ''    -> ERROR "invalid input syntax for type uuid",
--       and it keeps erroring until reset. The backend must therefore set a
--       valid uuid or RESET the setting — never the empty string.
-- Created at: 2026-09-18

BEGIN;

-- 1. Uniform tenant policy everywhere it is missing. ─────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND a.attname = 'tenant_id'
       AND a.attnum > 0
       AND NOT a.attisdropped
       -- Leave tables that already have ANY policy to their author.
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (tenant_id = (current_setting(''app.tenant_id'', true))::uuid)'
      || ' WITH CHECK (tenant_id = (current_setting(''app.tenant_id'', true))::uuid)',
      'tenant_isolation_' || r.table_name, r.table_name);
  END LOOP;
END $$;

-- Tables that had RLS enabled but no policy would deny everything to a
-- non-superuser; the loop above covers them because it keys off the absence of
-- a POLICY, not the absence of RLS.

-- 2. The application role the policies bind to. ──────────────────────────────
-- NOSUPERUSER + NOBYPASSRLS is the whole point: as long as the backend connects
-- as `aire` (superuser), none of the above has any effect.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aire_app') THEN
    CREATE ROLE aire_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE aire_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO aire_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aire_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO aire_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aire_app;

-- Tables and sequences created by future migrations (which run as `aire`) must
-- be reachable by the app role without another grant pass.
ALTER DEFAULT PRIVILEGES FOR ROLE aire IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aire_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aire IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO aire_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aire IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO aire_app;

COMMIT;
