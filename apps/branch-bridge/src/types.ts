/**
 * Protocol DTOs for the Branch Bridge Agent <-> Cloud (/bridge namespace).
 *
 * These names + field names MUST match docs/tech/07-branch-bridge-protocol.md
 * letter-for-letter. Kept local to this app (do NOT import from @aire/shared).
 */

export type DeviceType =
  | 'camera'
  | 'nvr'
  | 'printer'
  | 'barcode_scanner'
  | 'iot_controller'
  | 'router'
  | 'pos_terminal'
  | 'kiosk'
  | 'tablet'
  | 'unknown';

/**
 * A discovered device reported to the cloud during a scan.
 * The cloud assigns device_id, suggested_label, status, timestamps.
 */
export interface DiscoveredDeviceInput {
  ip_address: string;
  device_type: DeviceType;
  manufacturer: string | null;
  model: string | null;
  connection_params?: Record<string, unknown>;
}

/** Command actions the cloud can dispatch to a bay controller. */
export type BayCommandAction =
  | 'gate_open'
  | 'gate_close'
  | 'start_wash'
  | 'stop_wash'
  | 'emergency_stop';

// ---------------------------------------------------------------------------
// Cloud -> Agent event payloads
// ---------------------------------------------------------------------------

export interface ScanRequest {
  scanId: string;
  protocols?: string[];
}

export interface ConfigureRequest {
  deviceId: string;
  device_type: DeviceType;
  connection_params: Record<string, unknown>;
}

export interface StreamStartRequest {
  cameraId: string;
  rtspUrl: string;
}

export interface StreamStopRequest {
  cameraId: string;
}

export interface CommandRequest {
  bayId: string;
  action: BayCommandAction;
}

// ---------------------------------------------------------------------------
// Agent -> Cloud event payloads
// ---------------------------------------------------------------------------

export interface DeviceEvent {
  scanId: string;
  device: DiscoveredDeviceInput;
}

export interface ScanError {
  protocol: string;
  message: string;
}

export interface ScanDoneEvent {
  scanId: string;
  count: number;
  errors: ScanError[];
}

export interface ConfigureResultEvent {
  deviceId: string;
  ok: boolean;
  error?: string;
  connection_params?: Record<string, unknown>;
}

export interface HlsPlaylistEvent {
  cameraId: string;
  m3u8: string;
}

export interface HlsSegmentEvent {
  cameraId: string;
  name: string;
  dataB64: string;
  durationSec: number;
  seq: number;
}

/**
 * Sensor reading forwarded from a local bay controller.
 * Field shape mirrors the IoT gateway SensorMessage plus bayId.
 */
export interface SensorEvent {
  bayId: string;
  vehiclePresent: boolean;
  waterFlow: number;
  foamLevel: number;
  machineStatus: 'idle' | 'running' | 'error';
  timestamp: string;
}

export interface HeartbeatEvent {
  ts: number;
  cameras: string[];
  devices: string[];
}

/** Typed map of agent->cloud emit events (event name -> payload). */
export interface AgentToCloudEvents {
  device: DeviceEvent;
  'scan:done': ScanDoneEvent;
  'configure:result': ConfigureResultEvent;
  'hls:playlist': HlsPlaylistEvent;
  'hls:segment': HlsSegmentEvent;
  sensor: SensorEvent;
  heartbeat: HeartbeatEvent;
}
