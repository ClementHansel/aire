-- Migration: 095_service_type_labels
-- Description: Tenant-renameable labels for the three service TYPES (AIRIN-175).
--
--   `services.category` stays the enum it has always been —
--   'car_wash' | 'add_on' | 'product' — because the value is load-bearing, not
--   cosmetic: the POS cart rule "a cart needs a main service" keys off
--   `car_wash`, the Services/Products pages split on `product`, and every
--   report groups by it. What the ticket actually asks for is that AIRE can
--   read "Utama" where the code says `car_wash`.
--
--   So this table stores a LABEL PER (tenant, code) and nothing else. There is
--   no way to add a fourth code from the UI, by design: a type the POS has no
--   rule for would silently break checkout validation.
--
--   Absent row = fall back to the built-in i18n label, so a tenant that never
--   renames anything behaves exactly as before and needs no row.
-- Created at: 2026-08-30

BEGIN;

CREATE TABLE IF NOT EXISTS service_type_labels (
  tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code       VARCHAR(20)  NOT NULL CHECK (code IN ('car_wash', 'add_on', 'product')),
  label      VARCHAR(60)  NOT NULL CHECK (btrim(label) <> ''),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, code)
);

COMMENT ON TABLE service_type_labels IS
  'Per-tenant display label for a service type code. The code set is fixed (see the CHECK) because POS cart validation and reporting key off it; only the wording is tenant-owned. AIRIN-175.';

ALTER TABLE service_type_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_service_type_labels ON service_type_labels;
CREATE POLICY tenant_isolation_service_type_labels ON service_type_labels
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

-- Keep updated_at honest via the shared trigger installed in 004.
DROP TRIGGER IF EXISTS set_updated_at_service_type_labels ON service_type_labels;
CREATE TRIGGER set_updated_at_service_type_labels
  BEFORE UPDATE ON service_type_labels
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;
