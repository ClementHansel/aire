import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DiscoveredDeviceType } from '../settings/settings.interfaces';

/**
 * Envelope every inbound agent event is tagged with before it is re-emitted on
 * the shared {@link BridgeEvents} bus. The bridge context (bridgeId / tenantId /
 * outletId) is resolved server-side from the socket's pairing token — the agent
 * can never widen its own scope, so downstream consumers can trust these fields.
 */
export interface BridgeEventContext {
  bridgeId: string;
  tenantId: string;
  outletId: string;
}

/** `device` — a single device found during a LAN scan. */
export interface DeviceEvent extends BridgeEventContext {
  scanId: string;
  device: {
    ip_address: string;
    device_type: DiscoveredDeviceType;
    manufacturer: string | null;
    model: string | null;
    connection_params?: Record<string, unknown>;
  };
}

/** `scan:done` — the agent has finished a scan for `scanId`. */
export interface ScanDoneEvent extends BridgeEventContext {
  scanId: string;
  count: number;
  errors: { protocol: string; message: string }[];
}

/** `configure:result` — the agent replied to a `configure` dispatch. */
export interface ConfigureResultEvent extends BridgeEventContext {
  deviceId: string;
  ok: boolean;
  error?: string;
  connection_params?: Record<string, unknown>;
}

/** `hls:playlist` — latest rolling live playlist for a camera. */
export interface HlsPlaylistEvent extends BridgeEventContext {
  cameraId: string;
  m3u8: string;
}

/** `hls:segment` — one HLS media segment (base64) for a camera. */
export interface HlsSegmentEvent extends BridgeEventContext {
  cameraId: string;
  name: string;
  dataB64: string;
  durationSec: number;
  seq: number;
}

/** `sensor` — a bay sensor reading relayed from local MQTT. */
export interface SensorEvent extends BridgeEventContext {
  bayId: string;
  vehiclePresent?: boolean;
  waterFlow?: number;
  foamLevel?: number;
  machineStatus?: string;
  timestamp?: string;
}

/** `heartbeat` — periodic liveness ping with the agent's online device set. */
export interface HeartbeatEvent extends BridgeEventContext {
  ts: number;
  cameras: string[];
  devices: string[];
}

/**
 * `bridge:offline` — the agent for this bridge disconnected. Not a socket event
 * from the agent; the gateway emits it locally so consumers can drop per-bridge
 * live state (e.g. Cctv must forget its "already streaming" set so the next live
 * request re-dispatches a fresh `stream:start` to the reconnected agent).
 */
export interface BridgeOfflineEvent extends BridgeEventContext {}

/**
 * Strongly-typed map of every event the {@link BridgeGateway} re-broadcasts onto
 * the in-process bus. Used only for documentation / editor help — the underlying
 * emitter is untyped Node `EventEmitter`.
 */
export interface BridgeEventMap {
  device: DeviceEvent;
  'scan:done': ScanDoneEvent;
  'configure:result': ConfigureResultEvent;
  'hls:playlist': HlsPlaylistEvent;
  'hls:segment': HlsSegmentEvent;
  sensor: SensorEvent;
  heartbeat: HeartbeatEvent;
  'bridge:offline': BridgeOfflineEvent;
}

/**
 * BridgeEvents — a plain Node {@link EventEmitter} exposed as an injectable
 * singleton. The {@link BridgeGateway} pushes inbound agent socket events onto
 * this bus; feature services (Discovery, Cctv, dispatch pending-resolution)
 * subscribe to it. This decouples the socket transport from the consumers and
 * keeps the module graph acyclic — nobody imports the gateway to receive data.
 */
@Injectable()
export class BridgeEvents extends EventEmitter {
  constructor() {
    super();
    // Many cameras / scans may listen concurrently; lift the default cap.
    this.setMaxListeners(0);
  }
}
