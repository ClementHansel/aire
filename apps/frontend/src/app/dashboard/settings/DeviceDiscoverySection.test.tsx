/**
 * Unit tests for DeviceDiscoverySection. Scan / list / confirm are wired to the
 * authenticated `api` client (mocked here).
 * Requirements: 9.4, 9.5, 10.5, 10.6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  DeviceDiscoverySection,
  DeviceCard,
  DeviceStatusCard,
  type DiscoveredDevice,
  type OutletOption,
} from './DeviceDiscoverySection';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const outlets: OutletOption[] = [
  { id: 'outlet-1', name: 'Outlet 1' },
  { id: 'outlet-2', name: 'Outlet 2' },
];

const mockDiscoveredDevice: DiscoveredDevice = {
  device_id: 'dev-001', ip_address: '192.168.1.100', device_type: 'camera',
  manufacturer: 'Hikvision', model: 'DS-2CD2143G2-I', suggested_label: 'Hikvision Camera',
  status: 'online', confirmed: false, assigned_bay_id: null, assigned_outlet_id: null,
  connection_params: {}, discovered_at: '2024-01-15T10:00:00Z', confirmed_at: null,
};

const mockConfirmedDevice: DiscoveredDevice = {
  device_id: 'dev-002', ip_address: '192.168.1.101', device_type: 'iot_controller',
  manufacturer: 'ESP32', model: 'DevKit', suggested_label: 'ESP32 IoT Controller',
  status: 'online', confirmed: true, assigned_bay_id: 'bay-1', assigned_outlet_id: 'outlet-1',
  connection_params: { mqtt_topic: 'devices/esp32' }, discovered_at: '2024-01-14T08:00:00Z', confirmed_at: '2024-01-14T09:00:00Z',
};

const mockOfflineDevice: DiscoveredDevice = {
  device_id: 'dev-003', ip_address: '192.168.1.102', device_type: 'router',
  manufacturer: null, model: null, suggested_label: 'Router',
  status: 'offline', confirmed: true, assigned_bay_id: null, assigned_outlet_id: 'outlet-2',
  connection_params: {}, discovered_at: '2024-01-13T12:00:00Z', confirmed_at: '2024-01-13T13:00:00Z',
};

describe('DeviceCard', () => {
  it('should render device label, IP and type', () => {
    render(<DeviceCard device={mockDiscoveredDevice} outlets={outlets} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('device-label-dev-001')).toHaveTextContent('Hikvision Camera');
    expect(screen.getByTestId('device-ip-dev-001')).toHaveTextContent('192.168.1.100');
  });

  it('should show outlet select on confirm click', () => {
    render(<DeviceCard device={mockDiscoveredDevice} outlets={outlets} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByTestId('device-confirm-button-dev-001'));
    expect(screen.getByTestId('device-outlet-select-dev-001')).toBeInTheDocument();
  });

  it('should call onConfirm with device id and selected outlet', () => {
    const onConfirm = vi.fn();
    render(<DeviceCard device={mockDiscoveredDevice} outlets={outlets} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('device-confirm-button-dev-001'));
    fireEvent.change(screen.getByTestId('device-outlet-select-dev-001'), { target: { value: 'outlet-1' } });
    fireEvent.click(screen.getByText('Assign & Confirm'));
    expect(onConfirm).toHaveBeenCalledWith('dev-001', 'outlet-1');
  });
});

describe('DeviceStatusCard', () => {
  it('should render online status', () => {
    render(<DeviceStatusCard device={mockConfirmedDevice} outlets={outlets} />);
    const status = screen.getByTestId('device-status-dev-002');
    expect(status).toHaveTextContent('online');
    expect(status).toHaveClass('device-status--online');
  });

  it('should render offline status', () => {
    render(<DeviceStatusCard device={mockOfflineDevice} outlets={outlets} />);
    const status = screen.getByTestId('device-status-dev-003');
    expect(status).toHaveTextContent('offline');
    expect(status).toHaveClass('device-status--offline');
  });

  it('should display the assigned outlet name', () => {
    render(<DeviceStatusCard device={mockConfirmedDevice} outlets={outlets} />);
    expect(screen.getByText('Outlet: Outlet 1')).toBeInTheDocument();
  });
});

describe('DeviceDiscoverySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue([mockDiscoveredDevice, mockConfirmedDevice, mockOfflineDevice]);
    mockApi.post.mockResolvedValue({});
  });

  it('should render the section and lists', async () => {
    render(<DeviceDiscoverySection tenantId="t1" outlets={outlets} />);
    expect(screen.getByTestId('device-discovery-section')).toBeInTheDocument();
    expect(screen.getByTestId('scan-button')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('discovered-devices-list')).toBeInTheDocument());
    expect(screen.getByTestId('confirmed-devices-list')).toBeInTheDocument();
  });

  it('should fetch devices on mount', async () => {
    render(<DeviceDiscoverySection tenantId="t1" outlets={outlets} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/discovery/t1/devices'));
  });

  it('should split discovered vs confirmed devices', async () => {
    render(<DeviceDiscoverySection tenantId="t1" outlets={outlets} />);
    await waitFor(() => expect(screen.getByTestId('device-card-dev-001')).toBeInTheDocument());
    expect(screen.getByTestId('device-card-dev-002')).toBeInTheDocument();
  });

  it('should call the scan endpoint when scan clicked', async () => {
    render(<DeviceDiscoverySection tenantId="t1" outlets={outlets} />);
    await waitFor(() => expect(screen.getByTestId('scan-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('scan-button'));
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/discovery/t1/scan', {}));
  });

  it('should confirm a device via the confirm endpoint', async () => {
    render(<DeviceDiscoverySection tenantId="t1" outlets={outlets} />);
    await waitFor(() => expect(screen.getByTestId('device-card-dev-001')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('device-confirm-button-dev-001'));
    fireEvent.change(screen.getByTestId('device-outlet-select-dev-001'), { target: { value: 'outlet-1' } });
    fireEvent.click(screen.getByText('Assign & Confirm'));

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/discovery/t1/devices/dev-001/confirm', { assigned_outlet_id: 'outlet-1' }),
    );
  });
});
