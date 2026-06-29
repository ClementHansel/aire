'use client';

/**
 * Device Discovery Section for Settings page.
 * Provides network scanning, device listing, and confirmation workflows.
 * Requirements: 9.4, 9.5, 10.5, 10.6
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// --- Types ---

export interface DiscoveredDevice {
  device_id: string;
  ip_address: string;
  device_type: 'camera' | 'iot_controller' | 'router';
  manufacturer: string | null;
  model: string | null;
  suggested_label: string;
  status: 'online' | 'offline' | 'unconfigured';
  confirmed: boolean;
  assigned_bay_id: string | null;
  assigned_outlet_id: string | null;
  connection_params: Record<string, unknown>;
  discovered_at: string;
  confirmed_at: string | null;
}

export interface DeviceStatusUpdate {
  device_id: string;
  status: 'online' | 'offline';
}

// --- Sub-Components ---

interface DeviceCardProps {
  device: DiscoveredDevice;
  onConfirm: (deviceId: string, outletId: string) => void;
}

/**
 * Card for a single discovered (unconfirmed) device.
 * Shows suggested label, IP, device type, status, and a confirm action.
 */
export function DeviceCard({ device, onConfirm }: DeviceCardProps) {
  const [showConfirmForm, setShowConfirmForm] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState('');

  const handleConfirm = () => {
    if (selectedOutlet) {
      onConfirm(device.device_id, selectedOutlet);
      setShowConfirmForm(false);
      setSelectedOutlet('');
    }
  };

  return (
    <div
      data-testid={`device-card-${device.device_id}`}
      className="device-card"
    >
      <div className="device-card-header">
        <span
          data-testid={`device-label-${device.device_id}`}
          className="device-label"
        >
          {device.suggested_label}
        </span>
        <span
          data-testid={`device-type-${device.device_id}`}
          className="device-type-badge"
        >
          {device.device_type}
        </span>
      </div>

      <div className="device-card-body">
        <span
          data-testid={`device-ip-${device.device_id}`}
          className="device-ip"
        >
          {device.ip_address}
        </span>
        <span
          data-testid={`device-status-${device.device_id}`}
          className={`device-status device-status--${device.status}`}
        >
          {device.status}
        </span>
      </div>

      <div className="device-card-actions">
        {!showConfirmForm ? (
          <button
            data-testid={`device-confirm-button-${device.device_id}`}
            className="device-confirm-button"
            onClick={() => setShowConfirmForm(true)}
          >
            Confirm Device
          </button>
        ) : (
          <div className="device-confirm-form">
            <select
              data-testid={`device-outlet-select-${device.device_id}`}
              className="device-outlet-select"
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
            >
              <option value="">Select outlet...</option>
              <option value="outlet-1">Outlet 1</option>
              <option value="outlet-2">Outlet 2</option>
              <option value="outlet-3">Outlet 3</option>
            </select>
            <button
              className="device-confirm-submit"
              onClick={handleConfirm}
              disabled={!selectedOutlet}
            >
              Assign &amp; Confirm
            </button>
            <button
              className="device-confirm-cancel"
              onClick={() => {
                setShowConfirmForm(false);
                setSelectedOutlet('');
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface DeviceStatusCardProps {
  device: DiscoveredDevice;
}

/**
 * Card for a confirmed device with real-time status indicator.
 * The status is updated via WebSocket pushes from the parent component.
 */
export function DeviceStatusCard({ device }: DeviceStatusCardProps) {
  return (
    <div
      data-testid={`device-card-${device.device_id}`}
      className="device-status-card"
    >
      <div className="device-status-card-header">
        <span
          data-testid={`device-label-${device.device_id}`}
          className="device-label"
        >
          {device.suggested_label}
        </span>
        <span
          data-testid={`device-type-${device.device_id}`}
          className="device-type-badge"
        >
          {device.device_type}
        </span>
      </div>

      <div className="device-status-card-body">
        <span
          data-testid={`device-ip-${device.device_id}`}
          className="device-ip"
        >
          {device.ip_address}
        </span>
        <span
          data-testid={`device-status-${device.device_id}`}
          className={`device-status device-status--${device.status}`}
        >
          {device.status}
        </span>
      </div>

      <div className="device-status-card-meta">
        {device.assigned_outlet_id && (
          <span className="device-outlet-assignment">
            Outlet: {device.assigned_outlet_id}
          </span>
        )}
        {device.confirmed_at && (
          <span className="device-confirmed-at">
            Confirmed: {new Date(device.confirmed_at).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Main Section Component ---

export interface DeviceDiscoverySectionProps {
  tenantId?: string;
  baseUrl?: string;
  wsUrl?: string;
}

/**
 * Device Discovery section with scan button, discovered device list,
 * and confirmed device list with real-time WebSocket status updates.
 */
export function DeviceDiscoverySection({
  tenantId = 'default',
  baseUrl = '/api',
  wsUrl,
}: DeviceDiscoverySectionProps) {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const discoveredDevices = devices.filter((d) => !d.confirmed);
  const confirmedDevices = devices.filter((d) => d.confirmed);

  // Fetch existing devices on mount
  const fetchDevices = useCallback(async () => {
    try {
      const response = await fetch(
        `${baseUrl}/discovery/${tenantId}/devices`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch devices (${response.status})`);
      }
      const data: DiscoveredDevice[] = await response.json();
      setDevices(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch devices',
      );
    }
  }, [baseUrl, tenantId]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // WebSocket connection for real-time status updates
  useEffect(() => {
    if (!wsUrl) return;

    const ws = new WebSocket(`${wsUrl}/discovery/${tenantId}/status`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const update: DeviceStatusUpdate = JSON.parse(event.data);
        setDevices((prev) =>
          prev.map((d) =>
            d.device_id === update.device_id
              ? { ...d, status: update.status }
              : d,
          ),
        );
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      // WebSocket errors are non-fatal; devices still work without real-time updates
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl, tenantId]);

  // Trigger a network scan
  const handleScan = async () => {
    setScanning(true);
    setError(null);

    try {
      const response = await fetch(
        `${baseUrl}/discovery/${tenantId}/scan`,
        { method: 'POST' },
      );
      if (!response.ok) {
        throw new Error(`Scan failed (${response.status})`);
      }
      // Refresh device list after scan
      await fetchDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  // Confirm a device with outlet assignment
  const handleConfirmDevice = async (
    deviceId: string,
    outletId: string,
  ) => {
    try {
      const response = await fetch(
        `${baseUrl}/discovery/${tenantId}/devices/${deviceId}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_outlet_id: outletId }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to confirm device (${response.status})`,
        );
      }
      // Update local state to reflect confirmation
      setDevices((prev) =>
        prev.map((d) =>
          d.device_id === deviceId
            ? {
                ...d,
                confirmed: true,
                assigned_outlet_id: outletId,
                confirmed_at: new Date().toISOString(),
              }
            : d,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to confirm device',
      );
    }
  };

  return (
    <div
      data-testid="device-discovery-section"
      className="device-discovery-section"
    >
      <h2 className="settings-section-title">Device Discovery</h2>
      <p className="settings-section-description">
        Discover and configure network devices such as cameras, IoT
        controllers, and routers.
      </p>

      <div className="device-discovery-controls">
        <button
          data-testid="scan-button"
          className="scan-button"
          onClick={handleScan}
          disabled={scanning}
        >
          {scanning ? 'Scanning...' : 'Scan Network'}
        </button>
        {scanning && (
          <span data-testid="scan-loading" className="scan-loading">
            Scanning network for devices...
          </span>
        )}
      </div>

      {error && (
        <div className="device-discovery-error" role="alert">
          {error}
        </div>
      )}

      <div data-testid="discovered-devices-list" className="device-list">
        <h3 className="device-list-title">
          Discovered Devices ({discoveredDevices.length})
        </h3>
        {discoveredDevices.length === 0 ? (
          <p className="device-list-empty">
            No unconfirmed devices. Run a network scan to discover new
            devices.
          </p>
        ) : (
          discoveredDevices.map((device) => (
            <DeviceCard
              key={device.device_id}
              device={device}
              onConfirm={handleConfirmDevice}
            />
          ))
        )}
      </div>

      <div data-testid="confirmed-devices-list" className="device-list">
        <h3 className="device-list-title">
          Confirmed Devices ({confirmedDevices.length})
        </h3>
        {confirmedDevices.length === 0 ? (
          <p className="device-list-empty">
            No confirmed devices yet. Confirm a discovered device to set
            it up.
          </p>
        ) : (
          confirmedDevices.map((device) => (
            <DeviceStatusCard key={device.device_id} device={device} />
          ))
        )}
      </div>
    </div>
  );
}

export default DeviceDiscoverySection;
