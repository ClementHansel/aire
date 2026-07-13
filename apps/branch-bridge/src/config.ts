import os from 'node:os';
import path from 'node:path';

/**
 * Runtime configuration for the Branch Bridge Agent, loaded from env.
 */
export interface BridgeConfig {
  /** Cloud backend base URL, e.g. http://localhost:4000 */
  cloudUrl: string;
  /** Opaque pairing token issued by the cloud; identifies this bridge. */
  bridgeToken: string;
  /** When true, skip all real hardware access and emit synthetic data. */
  simulate: boolean;
  /** Local MQTT broker URL. */
  mqttUrl: string;
  /** Optional explicit subnet to scan, e.g. "192.168.1.0/24". */
  scanSubnet?: string;
  /** Path to the ffmpeg system binary. */
  ffmpegPath: string;
  /** Directory to write transient HLS playlists/segments into. */
  hlsTmpDir: string;
  /** HTTP port for the local /health endpoint. */
  healthPort: number;
  /**
   * Tenant/outlet used when publishing MQTT commands. The cloud scopes data by
   * token, but the local command topic needs concrete ids. These may be learned
   * from incoming sensor topics if not provided.
   */
  tenantId: string;
  outletId: string;
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Load configuration from environment variables, applying sensible defaults.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const simulate = parseBool(env.AIRE_SIMULATE);

  return {
    cloudUrl: env.AIRE_CLOUD_URL || 'http://localhost:4000',
    bridgeToken: env.AIRE_BRIDGE_TOKEN || (simulate ? 'simulate-token' : ''),
    simulate,
    mqttUrl: env.AIRE_MQTT_URL || 'mqtt://localhost:1883',
    scanSubnet: env.SCAN_SUBNET || undefined,
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    hlsTmpDir: env.HLS_TMP_DIR || path.join(os.tmpdir(), 'aire-hls'),
    healthPort: parseInt(env.BRIDGE_HEALTH_PORT || '4010', 10),
    tenantId: env.AIRE_TENANT_ID || (simulate ? 'demo-tenant' : 'local'),
    outletId: env.AIRE_OUTLET_ID || (simulate ? 'demo-outlet' : 'local'),
  };
}
