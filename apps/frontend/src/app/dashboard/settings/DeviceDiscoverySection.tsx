'use client';

/**
 * Device Discovery section. Scans the tenant's network for cameras / IoT
 * controllers / routers, lists discovered + confirmed devices, and assigns a
 * discovered device to an outlet. Wired to the authenticated `api` client:
 *   POST /api/discovery/:tenantId/scan
 *   GET  /api/discovery/:tenantId/devices
 *   POST /api/discovery/:tenantId/devices/:deviceId/confirm
 * Requirements: 9.4, 9.5, 10.5, 10.6
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { DiscoveredDevice } from '@/lib/settings';
import { DeviceScanWizard } from './DeviceScanWizard';

export type { DiscoveredDevice };

export interface OutletOption { id: string; name: string }

interface DeviceCardProps {
  device: DiscoveredDevice;
  outlets: OutletOption[];
  onConfirm: (deviceId: string, outletId: string) => void;
}

/** Card for a single discovered (unconfirmed) device with a confirm action. */
export function DeviceCard({ device, outlets, onConfirm }: DeviceCardProps) {
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
    <div data-testid={`device-card-${device.device_id}`} className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span data-testid={`device-label-${device.device_id}`} className="text-sm font-medium text-text-primary">
          {device.suggested_label}
        </span>
        <span data-testid={`device-type-${device.device_id}`} className="badge bg-surface-sunken text-text-secondary capitalize">
          {device.device_type.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
        <span data-testid={`device-ip-${device.device_id}`} className="font-mono">{device.ip_address}</span>
        <span data-testid={`device-status-${device.device_id}`} className={`device-status device-status--${device.status} capitalize`}>
          {device.status}
        </span>
      </div>

      <div className="mt-3">
        {!showConfirmForm ? (
          <button
            data-testid={`device-confirm-button-${device.device_id}`}
            className="btn-secondary text-xs py-1.5"
            onClick={() => setShowConfirmForm(true)}
          >
            Confirm Device
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              data-testid={`device-outlet-select-${device.device_id}`}
              className="input-field py-1.5 text-xs w-auto"
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
            >
              <option value="">Select outlet…</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="btn-primary text-xs py-1.5" onClick={handleConfirm} disabled={!selectedOutlet}>
              Assign &amp; Confirm
            </button>
            <button className="btn-ghost text-xs py-1.5" onClick={() => { setShowConfirmForm(false); setSelectedOutlet(''); }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Card for a confirmed device with its assignment + status. */
export function DeviceStatusCard({ device, outlets }: { device: DiscoveredDevice; outlets?: OutletOption[] }) {
  const outletName = outlets?.find((o) => o.id === device.assigned_outlet_id)?.name ?? device.assigned_outlet_id;
  return (
    <div data-testid={`device-card-${device.device_id}`} className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span data-testid={`device-label-${device.device_id}`} className="text-sm font-medium text-text-primary">
          {device.suggested_label}
        </span>
        <span data-testid={`device-type-${device.device_id}`} className="badge bg-surface-sunken text-text-secondary capitalize">
          {device.device_type.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
        <span data-testid={`device-ip-${device.device_id}`} className="font-mono">{device.ip_address}</span>
        <span data-testid={`device-status-${device.device_id}`} className={`device-status device-status--${device.status} capitalize`}>
          {device.status}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {device.assigned_outlet_id && <span>Outlet: {outletName}</span>}
        {device.confirmed_at && <span>Confirmed: {new Date(device.confirmed_at).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}

export interface DeviceDiscoverySectionProps {
  tenantId: string;
  outlets?: OutletOption[];
}

export function DeviceDiscoverySection({ tenantId, outlets = [] }: DeviceDiscoverySectionProps) {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const discoveredDevices = devices.filter((d) => !d.confirmed);
  const confirmedDevices = devices.filter((d) => d.confirmed);

  const fetchDevices = useCallback(async () => {
    try {
      const data = await api.get<DiscoveredDevice[]>(`/discovery/${tenantId}/devices`);
      setDevices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
    }
  }, [tenantId]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      await api.post(`/discovery/${tenantId}/scan`, {});
      await fetchDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleConfirmDevice = async (deviceId: string, outletId: string) => {
    try {
      await api.post(`/discovery/${tenantId}/devices/${deviceId}/confirm`, { assigned_outlet_id: outletId });
      await fetchDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm device');
    }
  };

  return (
    <section data-testid="device-discovery-section" className="card space-y-4">
      <div>
        <h2 className="section-title">Device Discovery</h2>
        <p className="section-description">
          Scan your local network for cameras, IoT controllers, and routers, then assign each to an outlet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button data-testid="search-devices-button" className="btn-primary" onClick={() => setWizardOpen(true)}>
          🔎 Search devices
        </button>
        <button data-testid="scan-button" className="btn-secondary" onClick={handleScan} disabled={scanning}>
          {scanning ? 'Scanning…' : '🔍 Quick scan'}
        </button>
        {scanning && <span data-testid="scan-loading" className="text-sm text-text-muted">Scanning network for devices…</span>}
      </div>

      {wizardOpen && (
        <DeviceScanWizard
          tenantId={tenantId}
          outlets={outlets}
          onClose={() => setWizardOpen(false)}
          onComplete={fetchDevices}
        />
      )}

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700" role="alert">{error}</div>}

      <div data-testid="discovered-devices-list">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Discovered Devices ({discoveredDevices.length})</h3>
        {discoveredDevices.length === 0 ? (
          <p className="text-sm text-text-muted italic">No unconfirmed devices. Run a network scan to discover new devices.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {discoveredDevices.map((device) => (
              <DeviceCard key={device.device_id} device={device} outlets={outlets} onConfirm={handleConfirmDevice} />
            ))}
          </div>
        )}
      </div>

      <div data-testid="confirmed-devices-list">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Confirmed Devices ({confirmedDevices.length})</h3>
        {confirmedDevices.length === 0 ? (
          <p className="text-sm text-text-muted italic">No confirmed devices yet. Confirm a discovered device to set it up.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {confirmedDevices.map((device) => (
              <DeviceStatusCard key={device.device_id} device={device} outlets={outlets} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default DeviceDiscoverySection;
