/**
 * Core interfaces for the Device Discovery Module.
 *
 * Defines types for network scanning results, scan errors,
 * device confirmation, and health checks.
 *
 * Requirements: 9.1, 9.2, 9.3
 */

import { DiscoveredDevice } from '../settings/settings.interfaces';

/**
 * Protocols used for network device discovery.
 */
export type DiscoveryProtocol = 'onvif' | 'mqtt' | 'ssdp' | 'mdns';

/**
 * Error from an individual protocol scan.
 * Partial failures are expected — the system continues with other protocols.
 */
export interface ScanError {
  protocol: DiscoveryProtocol;
  message: string;
}

/**
 * Result of a full network scan across all protocols.
 * Contains discovered devices, total scan duration, and any protocol-level errors.
 */
export interface NetworkScanResult {
  devices: DiscoveredDevice[];
  scan_duration_ms: number;
  errors: ScanError[];
}

/**
 * Payload for confirming a discovered device and assigning it to infrastructure.
 */
export interface DeviceConfirmation {
  device_id: string;
  assigned_outlet_id: string;
  assigned_bay_id?: string;
}

/**
 * Result of a device health check ping.
 */
export interface DeviceHealthCheck {
  device_id: string;
  reachable: boolean;
  latency_ms: number | null;
  checked_at: string;
}
