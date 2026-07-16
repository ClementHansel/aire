'use client';

/**
 * Frontend DTOs for the Branch Bridge / CCTV feature. Kept local to the frontend
 * (not in @aire/shared) per docs/tech/07-branch-bridge-protocol.md conventions.
 */

export type BridgeStatus = 'online' | 'offline';

/** BridgeDTO returned by the backend (camelCase). List items also carry `live`. */
export interface BranchBridge {
  id: string;
  tenantId: string;
  outletId: string;
  name: string | null;
  status: BridgeStatus;
  agentVersion: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on `GET /api/bridges` list items — authoritative online flag. */
  live?: boolean;
}

/** Envelope returned by create + rotate-token — carries the one-time secret. */
export interface BridgePairing {
  bridge: BranchBridge;
  pairingToken: string;
  /** Primary install command (Windows PowerShell installer, token baked in). */
  installCommand: string;
  /** Alternative install commands for other platforms. */
  altInstall?: { linux: string; docker: string };
}

export interface ScanSession {
  scanId: string;
  tenantId: string;
  outletId: string;
  status: 'scanning' | 'done';
  devices: import('./settings').DiscoveredDevice[];
  errors: { protocol: string; message: string }[];
}

export interface CctvCamera {
  id: string;
  tenantId: string;
  outletId: string;
  bridgeId: string | null;
  name: string;
  rtspUrl: string;
  location: string | null;
  deviceId: string | null;
  isActive: boolean;
  isStreaming: boolean;
  lastFrameAt: string | null;
  playbackMeta?: CameraPlaybackMeta;
  createdAt: string;
  updatedAt: string;
}

/** NVR playback metadata; `vendor` present ⇒ the camera's archive is available. */
export interface CameraPlaybackMeta {
  vendor?: 'hikvision' | 'dahua' | 'onvif';
  host?: string;
  channel?: number;
  stream?: 'main' | 'sub';
  onvif?: boolean;
}

export interface CctvRecording {
  id: string;
  tenantId: string;
  outletId: string;
  cameraId: string;
  orderId: string | null;
  status: 'recording' | 'completed' | 'failed';
  storagePrefix: string | null;
  segmentCount: number;
  durationSeconds: number | null;
  startedAt: string;
  stoppedAt: string | null;
}

/** Prefer the authoritative `live` flag; else seen within the last 90 seconds. */
export function isBridgeOnline(b: Pick<BranchBridge, 'status' | 'lastSeenAt' | 'live'>): boolean {
  if (typeof b.live === 'boolean') return b.live;
  if (b.status === 'online') return true;
  if (!b.lastSeenAt) return false;
  return Date.now() - new Date(b.lastSeenAt).getTime() < 90_000;
}
