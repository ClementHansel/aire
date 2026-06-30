-- 021_bookings.sql
-- Appointment bookings: customers reserve a service slot ahead of arrival.
-- Filtered by tenant_id in the service layer (app pool bypasses RLS like other
-- tenant tables), so no RLS policy is added here.

CREATE TABLE IF NOT EXISTS bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id      UUID REFERENCES outlets(id) ON DELETE SET NULL,
  customer_name  VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(30),
  license_plate  VARCHAR(20),
  service_id     UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name   VARCHAR(255),
  scheduled_at   TIMESTAMPTZ NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'booked'
                   CHECK (status IN ('booked','confirmed','done','cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id, scheduled_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
