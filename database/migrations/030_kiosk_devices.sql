-- Migration: 030_kiosk_devices
-- Description: Self-service kiosk devices. Each kiosk (per outlet) holds an opaque
--   token embedded in its QR/launch URL. The token authorizes the public kiosk
--   order-create + charge endpoints and resolves the device's tenant + outlet,
--   so unauthenticated customers can order and pay without a random visitor being
--   able to spam orders. Kiosk orders are attributed to a per-tenant "Kiosk"
--   operator user (orders.operator_id is NOT NULL); that user is created lazily by
--   the backend and is login-disabled (unusable password hash).
-- Created at: 2026-07-09

BEGIN;

CREATE TABLE IF NOT EXISTS kiosk_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Token lookup happens on every kiosk request; index the active tokens.
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_token ON kiosk_devices(token) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_tenant ON kiosk_devices(tenant_id, created_at DESC);

COMMIT;
