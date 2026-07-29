-- Migration: 088_lpr_detections
-- Description: AIRIN-59 — LPR/ANPR plate detections, real-time matched to the
--   member database at the POS. Recognition happens OFF-platform (an ANPR
--   camera/NVR doing it on-device); the branch bridge forwards whatever it
--   reads to POST /api/lpr/detections (see packages/shared/src/interfaces/lpr.ts
--   for the vendor-neutral contract this table backs).
--
--   An earlier `alpr_detections` table existed (001_initial_schema) and was
--   dropped in 029_drop_alpr (the feature wasn't wired up yet). This is a fresh
--   table, not a resurrection: it reuses the good shape (confirmed_plate +
--   order_id support the cashier-confirm flow) but adds plate_normalized (the
--   same rule as normalizePlate() in @aire/shared, membership_plates, and
--   orders.plate_normalized from 084) so matching against membership_plates is
--   a plain equality join instead of an ad-hoc re-normalization per query.
--
--   `match` (customer/membership/vehicle) is deliberately NOT a column here —
--   it's derived at read time by joining membership_plates/memberships, so a
--   membership registered AFTER a detection still resolves correctly and a
--   membership that later expires shows its current status rather than a
--   stale snapshot.
-- Created at: 2026-07-30

BEGIN;

CREATE TABLE lpr_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  -- Opaque device identifier (vendor serial, channel id, ...) — never assume a vendor.
  camera_id VARCHAR(100) NOT NULL,
  -- As reported by the device.
  plate VARCHAR(20) NOT NULL,
  -- Canonical form (whitespace stripped, uppercased) — what matching uses.
  plate_normalized VARCHAR(20) NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 1,
  crop_image_url TEXT,
  -- Free-form device/vendor label, for support and debugging.
  source VARCHAR(100),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set once a cashier accepts the suggestion; NULL means still offerable.
  confirmed_plate VARCHAR(20),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "recent unconfirmed detections for this outlet", newest first,
-- polled/pushed to the POS. Partial index (confirmed_plate IS NULL) keeps it
-- small since confirmed rows are never queried by this path again.
CREATE INDEX idx_lpr_detections_outlet_unconfirmed
  ON lpr_detections(outlet_id, captured_at DESC)
  WHERE confirmed_plate IS NULL;

-- Confirm-lookup and tenant-scoped reads by id.
CREATE INDEX idx_lpr_detections_tenant ON lpr_detections(tenant_id);

-- RLS is currently inert (the app connects as a superuser, which bypasses RLS
-- regardless of policy), but every sibling table in this domain carries a
-- tenant_isolation policy — this must not be the odd one out if/when the app
-- role is ever tightened to a non-superuser.
ALTER TABLE lpr_detections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_lpr_detections ON lpr_detections;
CREATE POLICY tenant_isolation_lpr_detections ON lpr_detections
  FOR ALL
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);

COMMENT ON TABLE lpr_detections IS 'LPR/ANPR plate readings forwarded by the branch bridge (AIRIN-59). A detection is a suggestion until a cashier confirms it onto an order.';
COMMENT ON COLUMN lpr_detections.plate_normalized IS 'Whitespace-stripped, uppercased plate — matches membership_plates.plate_normalized and orders.plate_normalized.';
COMMENT ON COLUMN lpr_detections.confirmed_plate IS 'Set once a cashier accepts the detection (possibly correcting the OCR reading). NULL = still offerable, and excluded from the POS suggestion feed once set.';

COMMIT;
