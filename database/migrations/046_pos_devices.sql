-- Migration: 046_pos_devices
-- Description: Registered Point-of-Sale devices. POS is no longer reached from a
--   personal login redirect; instead each POS terminal is a device registered by
--   the tenant (owner/outlet-admin) and holds an opaque token embedded in its
--   launch URL. The token proves the terminal is an authorized POS and resolves
--   the device's tenant + outlet, so the POS front-end can pin its branch before a
--   cashier signs in. Unlike the kiosk (which orders unauthenticated), the cashier
--   still signs in on the device with their normal email + password, so every
--   order/shift/cash movement keeps its per-cashier attribution. Mirrors the
--   kiosk_devices model from migration 030.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS pos_devices (
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

-- Token lookup happens on every POS-device validation; index the active tokens.
CREATE INDEX IF NOT EXISTS idx_pos_devices_token ON pos_devices(token) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_pos_devices_tenant ON pos_devices(tenant_id, created_at DESC);

COMMIT;
