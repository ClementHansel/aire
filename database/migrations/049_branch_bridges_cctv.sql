-- Migration: 049_branch_bridges_cctv
-- Description: On-prem IoT/CCTV bridge model. Devices (cameras, ESP32 bay
--   controllers, routers) live on a branch's private LAN which the cloud VPS
--   cannot reach. Each branch runs a "branch bridge" agent that holds one
--   outbound socket to the cloud, scans its LAN, relays camera video (RTSP->HLS)
--   and shuttles bay sensor data / commands over MQTT. This migration adds:
--     - branch_bridges: one paired agent per outlet (opaque pairing token,
--       online/offline liveness). Mirrors the pos_devices/kiosk_devices token model.
--     - cameras: RTSP cameras confirmed via discovery, streamed live through the bridge.
--     - camera_recordings: event-based recording sessions (linked to an order),
--       stored as HLS VOD segments on MinIO.
-- Created at: 2026-07-12

BEGIN;

CREATE TABLE IF NOT EXISTS branch_bridges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  name VARCHAR(120),
  pairing_token VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'offline', -- online | offline
  agent_version VARCHAR(32),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One bridge per outlet keeps the "this branch's agent" mapping unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_bridges_outlet ON branch_bridges(outlet_id);
-- Token lookup happens on every socket handshake.
CREATE INDEX IF NOT EXISTS idx_branch_bridges_token ON branch_bridges(pairing_token);
CREATE INDEX IF NOT EXISTS idx_branch_bridges_tenant ON branch_bridges(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cameras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  bridge_id UUID REFERENCES branch_bridges(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  rtsp_url TEXT NOT NULL,
  location VARCHAR(120),
  device_id UUID,          -- discovery device_id this camera was confirmed from (nullable, opaque)
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_streaming BOOLEAN NOT NULL DEFAULT false,
  last_frame_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cameras_outlet ON cameras(outlet_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cameras_tenant ON cameras(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS camera_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  order_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'recording', -- recording | completed | failed
  storage_prefix TEXT,      -- MinIO key prefix: recordings/{cameraId}/{recordingId}/
  segment_count INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camera_recordings_camera ON camera_recordings(camera_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_camera_recordings_outlet ON camera_recordings(outlet_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_camera_recordings_order ON camera_recordings(order_id) WHERE order_id IS NOT NULL;

COMMIT;
