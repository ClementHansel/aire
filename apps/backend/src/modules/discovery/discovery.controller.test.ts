import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';
import type { DiscoveredDevice } from '../settings/settings.interfaces';
import type { NetworkScanResult, DeviceHealthCheck } from './discovery.types';

describe('DiscoveryController', () => {
  let controller: DiscoveryController;
  let mockDiscoveryService: {
    scanNetwork: ReturnType<typeof vi.fn>;
    confirmDevice: ReturnType<typeof vi.fn>;
    healthCheck: ReturnType<typeof vi.fn>;
  };
  let mockSettingsService: {
    getSettings: ReturnType<typeof vi.fn>;
  };

  const mockTenantId = 'tenant-001';
  const mockDeviceId = 'device-abc-123';

  const mockDevice: DiscoveredDevice = {
    device_id: mockDeviceId,
    ip_address: '192.168.1.100',
    device_type: 'camera',
    manufacturer: 'Hikvision',
    model: 'DS-2CD2143G2-I',
    suggested_label: 'Camera - Hikvision',
    status: 'unconfigured',
    confirmed: false,
    assigned_bay_id: null,
    assigned_outlet_id: null,
    connection_params: {},
    discovered_at: '2024-01-15T10:00:00.000Z',
    confirmed_at: null,
  };

  const mockConfirmedDevice: DiscoveredDevice = {
    ...mockDevice,
    confirmed: true,
    status: 'online',
    assigned_outlet_id: 'outlet-001',
    assigned_bay_id: 'bay-001',
    confirmed_at: '2024-01-15T11:00:00.000Z',
    connection_params: {
      rtsp_url: 'rtsp://192.168.1.100:554/stream',
      rtsp_port: 554,
      stream_path: '/stream',
      protocol: 'rtsp',
    },
  };

  const mockScanResult: NetworkScanResult = {
    devices: [mockDevice],
    scan_duration_ms: 1200,
    errors: [],
  };

  const mockHealthCheck: DeviceHealthCheck = {
    device_id: mockDeviceId,
    reachable: true,
    latency_ms: 12,
    checked_at: '2024-01-15T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscoveryService = {
      scanNetwork: vi.fn().mockResolvedValue(mockScanResult),
      confirmDevice: vi.fn().mockResolvedValue(mockConfirmedDevice),
      healthCheck: vi.fn().mockResolvedValue([mockHealthCheck]),
    };

    mockSettingsService = {
      getSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_AUTOMATION_SETTINGS,
        discovered_devices: [mockDevice, mockConfirmedDevice],
      }),
    };

    controller = new DiscoveryController(
      mockDiscoveryService as unknown as DiscoveryService,
      mockSettingsService as unknown as SettingsService,
    );
  });

  describe('POST /api/discovery/:tenantId/scan', () => {
    it('should initiate a network scan and return results', async () => {
      const result = await controller.scanNetwork(mockTenantId);

      expect(mockDiscoveryService.scanNetwork).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(mockScanResult);
      expect(result.devices).toHaveLength(1);
      expect(result.scan_duration_ms).toBe(1200);
    });

    it('should return scan results with errors when protocols fail', async () => {
      const resultWithErrors: NetworkScanResult = {
        devices: [mockDevice],
        scan_duration_ms: 3000,
        errors: [
          { protocol: 'onvif', message: 'Timeout scanning ONVIF devices' },
          { protocol: 'mqtt', message: 'MQTT broker unreachable' },
        ],
      };
      mockDiscoveryService.scanNetwork.mockResolvedValue(resultWithErrors);

      const result = await controller.scanNetwork(mockTenantId);

      expect(result.errors).toHaveLength(2);
      expect(result.devices).toHaveLength(1);
    });

    it('should return empty results when no devices found', async () => {
      mockDiscoveryService.scanNetwork.mockResolvedValue({
        devices: [],
        scan_duration_ms: 500,
        errors: [],
      });

      const result = await controller.scanNetwork(mockTenantId);

      expect(result.devices).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('GET /api/discovery/:tenantId/devices', () => {
    it('should list all discovered and confirmed devices', async () => {
      const result = await controller.listDevices(mockTenantId);

      expect(mockSettingsService.getSettings).toHaveBeenCalledWith(mockTenantId);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockDevice);
      expect(result[1]).toEqual(mockConfirmedDevice);
    });

    it('should return an empty array when no devices exist', async () => {
      mockSettingsService.getSettings.mockResolvedValue({
        ...DEFAULT_AUTOMATION_SETTINGS,
        discovered_devices: [],
      });

      const result = await controller.listDevices(mockTenantId);

      expect(result).toEqual([]);
    });

    it('should propagate NotFoundException when tenant not found', async () => {
      mockSettingsService.getSettings.mockRejectedValue(
        new NotFoundException('Tenant not found'),
      );

      await expect(controller.listDevices('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('POST /api/discovery/:tenantId/devices/:deviceId/confirm', () => {
    it('should confirm a device with outlet assignment', async () => {
      const body = {
        assigned_outlet_id: 'outlet-001',
        assigned_bay_id: 'bay-001',
      };

      const result = await controller.confirmDevice(mockTenantId, mockDeviceId, body);

      expect(mockDiscoveryService.confirmDevice).toHaveBeenCalledWith(
        mockTenantId,
        {
          device_id: mockDeviceId,
          assigned_outlet_id: 'outlet-001',
          assigned_bay_id: 'bay-001',
        },
      );
      expect(result).toEqual(mockConfirmedDevice);
      expect(result.confirmed).toBe(true);
      expect(result.assigned_outlet_id).toBe('outlet-001');
    });

    it('should confirm a device without bay assignment', async () => {
      const body = {
        assigned_outlet_id: 'outlet-002',
      };

      await controller.confirmDevice(mockTenantId, mockDeviceId, body);

      expect(mockDiscoveryService.confirmDevice).toHaveBeenCalledWith(
        mockTenantId,
        {
          device_id: mockDeviceId,
          assigned_outlet_id: 'outlet-002',
          assigned_bay_id: undefined,
        },
      );
    });

    it('should propagate NotFoundException when device not found', async () => {
      mockDiscoveryService.confirmDevice.mockRejectedValue(
        new NotFoundException('Device unknown-device not found in tenant\'s discovered devices'),
      );

      await expect(
        controller.confirmDevice(mockTenantId, 'unknown-device', {
          assigned_outlet_id: 'outlet-001',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('GET /api/discovery/:tenantId/devices/:deviceId/health', () => {
    it('should return health status for a specific device', async () => {
      const result = await controller.getDeviceHealth(mockTenantId, mockDeviceId);

      expect(mockDiscoveryService.healthCheck).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(mockHealthCheck);
      expect(result!.reachable).toBe(true);
      expect(result!.latency_ms).toBe(12);
    });

    it('should return null when device not found in health check results', async () => {
      const result = await controller.getDeviceHealth(mockTenantId, 'unknown-device');

      expect(result).toBeNull();
    });

    it('should return health check with offline status', async () => {
      const offlineCheck: DeviceHealthCheck = {
        device_id: mockDeviceId,
        reachable: false,
        latency_ms: null,
        checked_at: '2024-01-15T12:00:00.000Z',
      };
      mockDiscoveryService.healthCheck.mockResolvedValue([offlineCheck]);

      const result = await controller.getDeviceHealth(mockTenantId, mockDeviceId);

      expect(result).toEqual(offlineCheck);
      expect(result!.reachable).toBe(false);
      expect(result!.latency_ms).toBeNull();
    });

    it('should return null when no confirmed devices exist', async () => {
      mockDiscoveryService.healthCheck.mockResolvedValue([]);

      const result = await controller.getDeviceHealth(mockTenantId, mockDeviceId);

      expect(result).toBeNull();
    });
  });
});
