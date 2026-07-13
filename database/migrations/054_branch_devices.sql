-- Migration: 054_branch_devices
-- Description: Unified branch device registry. Turns the branch-bridge into a
--   branch edge controller: every LAN device a bridge can see (camera, bay
--   controller, printer, router) — plus, via UNION at read time, the existing
--   pos_devices / kiosk_devices — is registered once in `branch_devices` and then
--   permanently managed + monitored from the cloud (registry UI + topology tree).
--
--   `branch_devices` is the single source of truth for the registry; specialized
--   tables (cameras, pos_devices, kiosk_devices) keep their type-specific columns
--   and are linked back via `ref_id`. Rows are written by:
--     - Discovery confirm (DiscoveryService.confirmDevice): camera→camera
--       (ref_id = cameras.id), iot_controller→controller, router→router.
--     - Heartbeat / bridge:offline: the bridge gateway flips a branch's devices
--       online/offline (via the in-process BridgeEvents bus).
--   Builds on migration 049 (branch_bridges + cameras). Mirrors the token-model
--   style of 030_kiosk_devices / 046_pos_devices.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS branch_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  -- NULL ok: some devices are cloud-direct (no on-prem bridge). Bridge removal
  -- keeps the device row (bridge_id → NULL), matching the cameras FK behaviour.
  bridge_id UUID REFERENCES branch_bridges(id) ON DELETE SET NULL,
  category VARCHAR(24) NOT NULL,   -- camera | controller | printer | kiosk | pos_terminal | router | other
  name VARCHAR(160) NOT NULL,
  vendor VARCHAR(120),
  model VARCHAR(120),
  ip_address VARCHAR(64),
  mac_address VARCHAR(64),
  ref_id UUID,                     -- link to cameras.id / pos_devices.id / kiosk_devices.id
  connection_params JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'unconfigured',  -- online | offline | unconfigured
  metadata JSONB NOT NULL DEFAULT '{}',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registry + topology read the tree grouped by outlet then category.
CREATE INDEX IF NOT EXISTS idx_branch_devices_outlet ON branch_devices(outlet_id, category);
-- Tenant-wide "recent devices" listing.
CREATE INDEX IF NOT EXISTS idx_branch_devices_tenant ON branch_devices(tenant_id, created_at DESC);
-- A given bridge reports at most one device per LAN IP: dedupe the discovery
-- upsert. Partial so multiple cloud-direct rows (bridge_id NULL) or IP-less rows
-- do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_devices_bridge_ip
  ON branch_devices(bridge_id, ip_address)
  WHERE ip_address IS NOT NULL;

COMMIT;
