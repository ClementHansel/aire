/**
 * Unit tests for DeviceDiscoverySection component.
 * Tests scan button, discovered device list, confirmed device list,
 * device cards, and real-time WebSocket status updates.
 * Requirements: 9.4, 9.5, 10.5, 10.6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  DeviceDiscoverySection,
  DeviceCard,
  DeviceStatusCard,
  DiscoveredDevice,
} from './DeviceDiscoverySection';

// --- Mock Data ---

const mockDiscoveredDevice: DiscoveredDevice = {
  device_id: 'dev-001',
  ip_address: '192.168.1.100',
  device_type: 'camera',
  manufacturer: 'Hikvision',
  model: 'DS-2CD2143G2-I',
  suggested_label: 'Hikvision Camera',
  status: 'online',
  confirmed: false,
  assigned_bay_id: null,
  assigned_outlet_id: null,
  connection_params: {},
  discovered_at: '2024-01-15T10:00:00Z',
  confirmed_at: null,
};

const mockConfirmedDevice: DiscoveredDevice = {
  device_id: 'dev-002',
  ip_address: '192.168.1.101',
  device_type: 'iot_controller',
  manufacturer: 'ESP32',
  model: 'DevKit',
  suggested_label: 'ESP32 IoT Controller',
  status: 'online',
  confirmed: true,
  assigned_bay_id: 'bay-1',
  assigned_outlet_id: 'outlet-1',
  connection_params: { mqtt_topic: 'devices/esp32' },
  discovered_at: '2024-01-14T08:00:00Z',
  confirmed_at: '2024-01-14T09:00:00Z',
};

const mockOfflineDevice: DiscoveredDevice = {
  device_id: 'dev-003',
  ip_address: '192.168.1.102',
  device_type: 'router',
  manufacturer: null,
  model: null,
  suggested_label: 'Router',
  status: 'offline',
  confirmed: true,
  assigned_bay_id: null,
  assigned_outlet_id: 'outlet-2',
  connection_params: {},
  discovered_at: '2024-01-13T12:00:00Z',
  confirmed_at: '2024-01-13T13:00:00Z',
};

// --- Mock WebSocket ---

class MockWebSocket {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  readyState = 1;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    mockWebSocketInstances.push(this);
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }
}

let mockWebSocketInstances: MockWebSocket[] = [];

// --- Tests ---

describe('DeviceCard', () => {
  it('should render device label', () => {
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={vi.fn()} />);
    const label = screen.getByTestId('device-label-dev-001');
    expect(label).toHaveTextContent('Hikvision Camera');
  });

  it('should render device IP address', () => {
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={vi.fn()} />);
    const ip = screen.getByTestId('device-ip-dev-001');
    expect(ip).toHaveTextContent('192.168.1.100');
  });

  it('should render device type badge', () => {
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={vi.fn()} />);
    const type = screen.getByTestId('device-type-dev-001');
    expect(type).toHaveTextContent('camera');
  });

  it('should render device status', () => {
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={vi.fn()} />);
    const status = screen.getByTestId('device-status-dev-001');
    expect(status).toHaveTextContent('online');
  });

  it('should render confirm button', () => {
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={vi.fn()} />);
    const btn = screen.getByTestId('device-confirm-button-dev-001');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Confirm Device');
  });

  it('should show outlet select on confirm button click', () => {
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByTestId('device-confirm-button-dev-001'));
    expect(screen.getByTestId('device-outlet-select-dev-001')).toBeInTheDocument();
  });

  it('should call onConfirm with device id and selected outlet', () => {
    const onConfirm = vi.fn();
    render(<DeviceCard device={mockDiscoveredDevice} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('device-confirm-button-dev-001'));
    fireEvent.change(screen.getByTestId('device-outlet-select-dev-001'), {
      target: { value: 'outlet-1' },
    });
    fireEvent.click(screen.getByText('Assign & Confirm'));

    expect(onConfirm).toHaveBeenCalledWith('dev-001', 'outlet-1');
  });
});

describe('DeviceStatusCard', () => {
  it('should render confirmed device label', () => {
    render(<DeviceStatusCard device={mockConfirmedDevice} />);
    expect(screen.getByTestId('device-label-dev-002')).toHaveTextContent(
      'ESP32 IoT Controller',
    );
  });

  it('should render confirmed device IP', () => {
    render(<DeviceStatusCard device={mockConfirmedDevice} />);
    expect(screen.getByTestId('device-ip-dev-002')).toHaveTextContent('192.168.1.101');
  });

  it('should render online status for confirmed device', () => {
    render(<DeviceStatusCard device={mockConfirmedDevice} />);
    const status = screen.getByTestId('device-status-dev-002');
    expect(status).toHaveTextContent('online');
    expect(status).toHaveClass('device-status--online');
  });

  it('should render offline status for offline device', () => {
    render(<DeviceStatusCard device={mockOfflineDevice} />);
    const status = screen.getByTestId('device-status-dev-003');
    expect(status).toHaveTextContent('offline');
    expect(status).toHaveClass('device-status--offline');
  });

  it('should display outlet assignment', () => {
    render(<DeviceStatusCard device={mockConfirmedDevice} />);
    expect(screen.getByText('Outlet: outlet-1')).toBeInTheDocument();
  });
});

describe('DeviceDiscoverySection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWebSocketInstances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Default: return mixed devices
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [mockDiscoveredDevice, mockConfirmedDevice, mockOfflineDevice],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should render the section container', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('device-discovery-section')).toBeInTheDocument();
    });
  });

  it('should render the scan button', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('scan-button')).toBeInTheDocument();
    });
  });

  it('should render discovered devices list', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('discovered-devices-list')).toBeInTheDocument();
    });
  });

  it('should render confirmed devices list', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('confirmed-devices-list')).toBeInTheDocument();
    });
  });

  it('should fetch devices on mount', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/discovery/t1/devices');
    });
  });

  it('should display discovered (unconfirmed) devices in discovered list', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('device-card-dev-001')).toBeInTheDocument();
    });
  });

  it('should display confirmed devices in confirmed list', async () => {
    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('device-card-dev-002')).toBeInTheDocument();
    });
  });

  it('should show loading indicator during scan', async () => {
    // Make scan request hang
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/scan')) {
        return new Promise(() => {}); // Never resolves
      }
      return Promise.resolve({
        ok: true,
        json: async () => [mockDiscoveredDevice, mockConfirmedDevice],
      });
    });

    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('scan-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scan-button'));
    await waitFor(() => {
      expect(screen.getByTestId('scan-loading')).toBeInTheDocument();
    });
  });

  it('should call scan endpoint when scan button is clicked', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/scan') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [mockDiscoveredDevice, mockConfirmedDevice],
      });
    });

    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('scan-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scan-button'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/discovery/t1/scan', {
        method: 'POST',
      });
    });
  });

  it('should update device status via WebSocket message', async () => {
    render(
      <DeviceDiscoverySection
        tenantId="t1"
        baseUrl="/api"
        wsUrl="ws://localhost:3001"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('device-status-dev-002')).toHaveTextContent('online');
    });

    // Simulate WebSocket status update
    act(() => {
      mockWebSocketInstances[0]?.simulateMessage({
        device_id: 'dev-002',
        status: 'offline',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('device-status-dev-002')).toHaveTextContent('offline');
    });
  });

  it('should confirm a device and move it to confirmed list', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/confirm') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [mockDiscoveredDevice],
      });
    });

    render(<DeviceDiscoverySection tenantId="t1" baseUrl="/api" />);

    await waitFor(() => {
      expect(screen.getByTestId('device-card-dev-001')).toBeInTheDocument();
    });

    // Click confirm button, select outlet, and submit
    fireEvent.click(screen.getByTestId('device-confirm-button-dev-001'));
    fireEvent.change(screen.getByTestId('device-outlet-select-dev-001'), {
      target: { value: 'outlet-1' },
    });
    fireEvent.click(screen.getByText('Assign & Confirm'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/discovery/t1/devices/dev-001/confirm',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ assigned_outlet_id: 'outlet-1' }),
        }),
      );
    });
  });
});
