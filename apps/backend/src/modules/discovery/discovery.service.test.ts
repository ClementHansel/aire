import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { BridgeDispatchService } from '../bridge/bridge-dispatch.service';
import { BridgeEvents } from '../bridge/bridge.events';
import { DiscoveredDevice, TenantAutomationSettings, DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';
import { DeviceConfirmation } from './discovery.types';

/**
 * Unit tests for DiscoveryService — device confirmation and auto-configuration.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.5
 */

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function createMockDevice(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    device_id: 'device-001',
    ip_address: '192.168.1.100',
    device_type: 'camera',
    manufacturer: 'Hikvision',
    model: 'DS-2CD2143G0-I',
    suggested_label: 'Camera - Hikvision',
    status: 'unconfigured',
    confirmed: false,
    assigned_bay_id: null,
    assigned_outlet_id: null,
    connection_params: {},
    discovered_at: '2024-01-01T00:00:00.000Z',
    confirmed_at: null,
    ...overrides,
  };
}

function createMockSettings(devices: DiscoveredDevice[] = []): TenantAutomationSettings {
  return {
    ...DEFAULT_AUTOMATION_SETTINGS,
    discovered_devices: devices,
  };
}

function createMockSettingsService(settings: TenantAutomationSettings) {
  return {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
  } as unknown as SettingsService;
}

function createMockAuditService() {
  return {
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DiscoveryService - confirmDevice', () => {
  let service: DiscoveryService;
  let mockSettingsService: SettingsService;
  const tenantId = 'tenant-123';

  describe('successful camera confirmation', () => {
    const cameraDevice = createMockDevice({ device_type: 'camera' });
    const settings = createMockSettings([cameraDevice]);

    beforeEach(() => {
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
    });

    it('should confirm device and set RTSP connection params', async () => {
      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
        assigned_bay_id: 'bay-1',
      };

      const result = await service.confirmDevice(tenantId, confirmation);

      expect(result.confirmed).toBe(true);
      expect(result.assigned_outlet_id).toBe('outlet-abc');
      expect(result.assigned_bay_id).toBe('bay-1');
      expect(result.confirmed_at).toBeDefined();
      expect(result.status).toBe('online');
      expect(result.connection_params).toMatchObject({
        rtsp_url: 'rtsp://192.168.1.100:554/stream',
        rtsp_port: 554,
        stream_path: '/stream',
        protocol: 'rtsp',
      });
    });

    it('should update settings via SettingsService', async () => {
      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
      };

      await service.confirmDevice(tenantId, confirmation);

      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        tenantId,
        null,
        expect.objectContaining({
          discovered_devices: expect.arrayContaining([
            expect.objectContaining({
              device_id: 'device-001',
              confirmed: true,
            }),
          ]),
        }),
      );
    });
  });

  describe('successful IoT controller confirmation', () => {
    const iotDevice = createMockDevice({
      device_id: 'device-002',
      device_type: 'iot_controller',
      ip_address: '192.168.1.200',
      manufacturer: 'Sonoff',
    });
    const settings = createMockSettings([iotDevice]);

    beforeEach(() => {
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
    });

    it('should confirm device and set MQTT connection params', async () => {
      const confirmation: DeviceConfirmation = {
        device_id: 'device-002',
        assigned_outlet_id: 'outlet-xyz',
      };

      const result = await service.confirmDevice(tenantId, confirmation);

      expect(result.confirmed).toBe(true);
      expect(result.assigned_outlet_id).toBe('outlet-xyz');
      expect(result.assigned_bay_id).toBeNull();
      expect(result.status).toBe('online');
      expect(result.connection_params).toMatchObject({
        mqtt_topic: `${tenantId}/iot/device-002/#`,
        mqtt_broker_ip: '192.168.1.200',
        mqtt_port: 1883,
        protocol: 'mqtt',
      });
    });
  });

  describe('successful router confirmation', () => {
    const routerDevice = createMockDevice({
      device_id: 'device-003',
      device_type: 'router',
      ip_address: '192.168.1.1',
      manufacturer: 'TP-Link',
    });
    const settings = createMockSettings([routerDevice]);

    beforeEach(() => {
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
    });

    it('should confirm router without additional connection params', async () => {
      const confirmation: DeviceConfirmation = {
        device_id: 'device-003',
        assigned_outlet_id: 'outlet-main',
      };

      const result = await service.confirmDevice(tenantId, confirmation);

      expect(result.confirmed).toBe(true);
      expect(result.assigned_outlet_id).toBe('outlet-main');
      expect(result.status).toBe('online');
      // Router should not have rtsp or mqtt params
      expect(result.connection_params).not.toHaveProperty('rtsp_url');
      expect(result.connection_params).not.toHaveProperty('mqtt_topic');
    });
  });

  describe('device not found', () => {
    const settings = createMockSettings([createMockDevice()]);

    beforeEach(() => {
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
    });

    it('should throw NotFoundException when device_id does not exist', async () => {
      const confirmation: DeviceConfirmation = {
        device_id: 'nonexistent-device',
        assigned_outlet_id: 'outlet-abc',
      };

      await expect(service.confirmDevice(tenantId, confirmation)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('auto-configuration failure handling', () => {
    it('should still confirm device but store error on auto-config failure', async () => {
      const cameraDevice = createMockDevice({ device_type: 'camera' });
      const settings = createMockSettings([cameraDevice]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);

      // Make autoconfigureCamera throw an error
      vi.spyOn(service, 'autoconfigureCamera').mockRejectedValueOnce(
        new Error('RTSP connection refused'),
      );

      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
      };

      const result = await service.confirmDevice(tenantId, confirmation);

      // Device should still be confirmed
      expect(result.confirmed).toBe(true);
      expect(result.status).toBe('online');
      // Error should be stored in connection_params
      expect(result.connection_params).toHaveProperty('auto_config_error');
      expect(result.connection_params.auto_config_error).toBe('RTSP connection refused');
    });

    it('should still confirm IoT device but store error on MQTT failure', async () => {
      const iotDevice = createMockDevice({
        device_id: 'device-002',
        device_type: 'iot_controller',
      });
      const settings = createMockSettings([iotDevice]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);

      // Make autoconfigureIoT throw an error
      vi.spyOn(service, 'autoconfigureIoT').mockRejectedValueOnce(
        new Error('MQTT broker unreachable'),
      );

      const confirmation: DeviceConfirmation = {
        device_id: 'device-002',
        assigned_outlet_id: 'outlet-xyz',
      };

      const result = await service.confirmDevice(tenantId, confirmation);

      expect(result.confirmed).toBe(true);
      expect(result.connection_params.auto_config_error).toBe('MQTT broker unreachable');
    });
  });

  describe('no SettingsService available', () => {
    it('should throw error if SettingsService is not injected', async () => {
      const serviceWithoutSettings = new DiscoveryService();

      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
      };

      await expect(
        serviceWithoutSettings.confirmDevice(tenantId, confirmation),
      ).rejects.toThrow('SettingsService is required for device confirmation');
    });
  });
});

describe('DiscoveryService - autoconfigureCamera', () => {
  let service: DiscoveryService;

  beforeEach(() => {
    service = new DiscoveryService();
  });

  it('should set RTSP URL based on device IP', async () => {
    const device = createMockDevice({
      ip_address: '10.0.0.50',
      device_type: 'camera',
    });

    await service.autoconfigureCamera(device);

    expect(device.connection_params.rtsp_url).toBe('rtsp://10.0.0.50:554/stream');
    expect(device.connection_params.rtsp_port).toBe(554);
    expect(device.connection_params.stream_path).toBe('/stream');
    expect(device.connection_params.protocol).toBe('rtsp');
    expect(device.connection_params.configured_at).toBeDefined();
  });

  it('should preserve existing connection_params', async () => {
    const device = createMockDevice({
      ip_address: '172.16.0.10',
      device_type: 'camera',
      connection_params: { existing_key: 'existing_value' },
    });

    await service.autoconfigureCamera(device);

    expect(device.connection_params.existing_key).toBe('existing_value');
    expect(device.connection_params.rtsp_url).toBe('rtsp://172.16.0.10:554/stream');
  });
});

describe('DiscoveryService - autoconfigureIoT', () => {
  let service: DiscoveryService;

  beforeEach(() => {
    service = new DiscoveryService();
  });

  it('should set MQTT topic based on tenant and device IDs', async () => {
    const device = createMockDevice({
      device_id: 'iot-device-42',
      ip_address: '192.168.1.150',
      device_type: 'iot_controller',
    });

    await service.autoconfigureIoT(device, 'tenant-abc');

    expect(device.connection_params.mqtt_topic).toBe('tenant-abc/iot/iot-device-42/#');
    expect(device.connection_params.mqtt_broker_ip).toBe('192.168.1.150');
    expect(device.connection_params.mqtt_port).toBe(1883);
    expect(device.connection_params.protocol).toBe('mqtt');
    expect(device.connection_params.configured_at).toBeDefined();
  });

  it('should preserve existing connection_params', async () => {
    const device = createMockDevice({
      device_id: 'iot-99',
      ip_address: '10.0.0.99',
      device_type: 'iot_controller',
      connection_params: { firmware_version: '1.2.3' },
    });

    await service.autoconfigureIoT(device, 'tenant-xyz');

    expect(device.connection_params.firmware_version).toBe('1.2.3');
    expect(device.connection_params.mqtt_topic).toBe('tenant-xyz/iot/iot-99/#');
  });
});

// ─── Health Check Tests ───────────────────────────────────────────────────────

describe('DiscoveryService - healthCheck', () => {
  let service: DiscoveryService;
  let mockSettingsService: SettingsService;
  const tenantId = 'tenant-123';

  describe('when all devices are reachable', () => {
    const confirmedCamera = createMockDevice({
      device_id: 'cam-001',
      device_type: 'camera',
      confirmed: true,
      status: 'online',
    });
    const confirmedIoT = createMockDevice({
      device_id: 'iot-001',
      device_type: 'iot_controller',
      confirmed: true,
      status: 'online',
      ip_address: '192.168.1.200',
    });

    beforeEach(() => {
      const settings = createMockSettings([confirmedCamera, confirmedIoT]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
      // Mock pingDevice to always return reachable
      vi.spyOn(service, 'pingDevice').mockResolvedValue({ reachable: true, latency_ms: 5 });
    });

    it('should return health check results for all confirmed devices', async () => {
      const results = await service.healthCheck(tenantId);

      expect(results).toHaveLength(2);
      expect(results[0]!.device_id).toBe('cam-001');
      expect(results[0]!.reachable).toBe(true);
      expect(results[0]!.latency_ms).toBe(5);
      expect(results[0]!.checked_at).toBeDefined();
      expect(results[1]!.device_id).toBe('iot-001');
      expect(results[1]!.reachable).toBe(true);
    });

    it('should not update settings when statuses have not changed', async () => {
      await service.healthCheck(tenantId);

      // No status change, so updateSettings should not be called
      expect(mockSettingsService.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('when a device becomes unreachable', () => {
    const onlineDevice = createMockDevice({
      device_id: 'cam-002',
      device_type: 'camera',
      confirmed: true,
      status: 'online',
    });

    beforeEach(() => {
      const settings = createMockSettings([onlineDevice]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
      // Mock pingDevice to return unreachable
      vi.spyOn(service, 'pingDevice').mockResolvedValue({ reachable: false, latency_ms: null });
    });

    it('should update device status to offline', async () => {
      const results = await service.healthCheck(tenantId);

      expect(results[0]!.reachable).toBe(false);
      expect(results[0]!.latency_ms).toBeNull();
    });

    it('should persist updated statuses via SettingsService', async () => {
      await service.healthCheck(tenantId);

      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        tenantId,
        null,
        expect.objectContaining({
          discovered_devices: expect.arrayContaining([
            expect.objectContaining({
              device_id: 'cam-002',
              status: 'offline',
            }),
          ]),
        }),
      );
    });
  });

  describe('when a device comes back online', () => {
    const offlineDevice = createMockDevice({
      device_id: 'cam-003',
      device_type: 'camera',
      confirmed: true,
      status: 'offline',
    });

    beforeEach(() => {
      const settings = createMockSettings([offlineDevice]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
      vi.spyOn(service, 'pingDevice').mockResolvedValue({ reachable: true, latency_ms: 12 });
    });

    it('should update device status to online', async () => {
      await service.healthCheck(tenantId);

      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        tenantId,
        null,
        expect.objectContaining({
          discovered_devices: expect.arrayContaining([
            expect.objectContaining({
              device_id: 'cam-003',
              status: 'online',
            }),
          ]),
        }),
      );
    });
  });

  describe('when no confirmed devices exist', () => {
    const unconfirmedDevice = createMockDevice({
      device_id: 'cam-004',
      confirmed: false,
      status: 'unconfigured',
    });

    beforeEach(() => {
      const settings = createMockSettings([unconfirmedDevice]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService);
    });

    it('should return empty array and not ping anything', async () => {
      const pingSpy = vi.spyOn(service, 'pingDevice');
      const results = await service.healthCheck(tenantId);

      expect(results).toHaveLength(0);
      expect(pingSpy).not.toHaveBeenCalled();
    });
  });

  describe('when SettingsService is not available', () => {
    it('should throw error if SettingsService is not injected', async () => {
      const serviceWithoutSettings = new DiscoveryService();

      await expect(serviceWithoutSettings.healthCheck(tenantId)).rejects.toThrow(
        'SettingsService is required for health checks',
      );
    });
  });
});

// ─── Audit Logging Tests ──────────────────────────────────────────────────────

describe('DiscoveryService - Audit Logging', () => {
  let service: DiscoveryService;
  let mockSettingsService: SettingsService;
  let mockAuditService: AuditService;
  const tenantId = 'tenant-audit-123';

  describe('scanNetwork audit logging', () => {
    let bridgeEvents: BridgeEvents;
    let mockDispatch: BridgeDispatchService;

    beforeEach(() => {
      mockSettingsService = createMockSettingsService(createMockSettings());
      mockAuditService = createMockAuditService();
      bridgeEvents = new BridgeEvents();
      mockDispatch = {
        dispatchScan: vi.fn().mockReturnValue('scan-audit-1'),
      } as unknown as BridgeDispatchService;
      service = new DiscoveryService(
        mockSettingsService,
        mockAuditService,
        mockDispatch,
        bridgeEvents,
      );
      service.onModuleInit();
    });

    it('should audit-log scan start on dispatch', async () => {
      const { scanId } = await service.scanNetwork(tenantId, 'outlet-1');

      expect(scanId).toBe('scan-audit-1');
      expect(mockDispatch.dispatchScan).toHaveBeenCalledWith('outlet-1');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: null,
          operation: 'device_scan_started',
          entityType: 'network_scan',
          entityId: 'scan-audit-1',
        }),
      );
    });

    it('should audit-log scan completion when scan:done arrives', async () => {
      const { scanId } = await service.scanNetwork(tenantId, 'outlet-1');

      bridgeEvents.emit('scan:done', {
        bridgeId: 'b1',
        tenantId,
        outletId: 'outlet-1',
        scanId,
        count: 0,
        errors: [],
      });
      // allow the async finalise() microtasks to settle
      await new Promise((r) => setTimeout(r, 0));

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: null,
          operation: 'device_scan_completed',
          entityType: 'network_scan',
          entityId: scanId,
          afterValue: expect.objectContaining({ devices_found: 0 }),
        }),
      );
    });
  });

  describe('confirmDevice audit logging', () => {
    const cameraDevice = createMockDevice({ device_type: 'camera' });

    beforeEach(() => {
      const settings = createMockSettings([cameraDevice]);
      mockSettingsService = createMockSettingsService(settings);
      mockAuditService = createMockAuditService();
      service = new DiscoveryService(mockSettingsService, mockAuditService);
    });

    it('should audit-log successful device confirmation with assigned outlet', async () => {
      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
        assigned_bay_id: 'bay-1',
      };

      await service.confirmDevice(tenantId, confirmation);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: null,
          operation: 'device_confirmed',
          entityType: 'discovered_device',
          entityId: 'device-001',
          afterValue: expect.objectContaining({
            device_type: 'camera',
            ip_address: '192.168.1.100',
            assigned_outlet_id: 'outlet-abc',
            assigned_bay_id: 'bay-1',
            auto_config_success: true,
          }),
        }),
      );
    });

    it('should audit-log auto-configuration failure separately', async () => {
      vi.spyOn(service, 'autoconfigureCamera').mockRejectedValueOnce(
        new Error('RTSP connection refused'),
      );

      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
      };

      await service.confirmDevice(tenantId, confirmation);

      // Should log both the confirmation and the failure
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'device_confirmed',
          afterValue: expect.objectContaining({
            auto_config_success: false,
            auto_config_error: 'RTSP connection refused',
          }),
        }),
      );

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'device_auto_config_failed',
          entityType: 'discovered_device',
          entityId: 'device-001',
          afterValue: expect.objectContaining({
            error: 'RTSP connection refused',
          }),
        }),
      );
    });
  });

  describe('no audit logging when AuditService is not injected', () => {
    it('should not throw when AuditService is not available', async () => {
      const settings = createMockSettings([createMockDevice()]);
      mockSettingsService = createMockSettingsService(settings);
      service = new DiscoveryService(mockSettingsService); // No AuditService

      const confirmation: DeviceConfirmation = {
        device_id: 'device-001',
        assigned_outlet_id: 'outlet-abc',
      };

      // Should not throw — audit logging is optional
      await expect(service.confirmDevice(tenantId, confirmation)).resolves.toBeDefined();
    });
  });
});

// ─── Bridge Scan Buffering Tests ──────────────────────────────────────────────

describe('DiscoveryService - scanNetwork (bridge model)', () => {
  let service: DiscoveryService;
  let mockSettingsService: SettingsService;
  let bridgeEvents: BridgeEvents;
  let mockDispatch: BridgeDispatchService;
  const tenantId = 'tenant-scan-1';
  const outletId = 'outlet-scan-1';

  beforeEach(() => {
    mockSettingsService = createMockSettingsService(createMockSettings());
    bridgeEvents = new BridgeEvents();
    mockDispatch = {
      dispatchScan: vi.fn().mockReturnValue('scan-1'),
    } as unknown as BridgeDispatchService;
    service = new DiscoveryService(
      mockSettingsService,
      undefined,
      mockDispatch,
      bridgeEvents,
    );
    service.onModuleInit();
  });

  it('should dispatch a scan and return the scanId', async () => {
    const result = await service.scanNetwork(tenantId, outletId);
    expect(result).toEqual({ scanId: 'scan-1' });
    expect(mockDispatch.dispatchScan).toHaveBeenCalledWith(outletId);
  });

  it('should throw when no bridge dispatch is wired', async () => {
    const bare = new DiscoveryService(mockSettingsService);
    await expect(bare.scanNetwork(tenantId, outletId)).rejects.toThrow(
      'BridgeDispatchService is required to start a scan',
    );
  });

  it('should buffer streamed device events and expose them via getScan', async () => {
    const { scanId } = await service.scanNetwork(tenantId, outletId);

    bridgeEvents.emit('device', {
      bridgeId: 'b1',
      tenantId,
      outletId,
      scanId,
      device: {
        ip_address: '192.168.1.77',
        device_type: 'camera',
        manufacturer: 'Hikvision',
        model: 'DS-1',
      },
    });

    const session = service.getScan(scanId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe('scanning');
    expect(session!.devices).toHaveLength(1);
    expect(session!.devices[0]!.ip_address).toBe('192.168.1.77');
    expect(session!.devices[0]!.suggested_label).toContain('Hikvision');
  });

  it('should mark done and persist devices on scan:done, keeping confirmed ones', async () => {
    const confirmed = createMockDevice({
      device_id: 'confirmed-1',
      ip_address: '10.0.0.1',
      confirmed: true,
    });
    mockSettingsService = createMockSettingsService(createMockSettings([confirmed]));
    service = new DiscoveryService(mockSettingsService, undefined, mockDispatch, bridgeEvents);
    service.onModuleInit();

    const { scanId } = await service.scanNetwork(tenantId, outletId);
    bridgeEvents.emit('device', {
      bridgeId: 'b1',
      tenantId,
      outletId,
      scanId,
      device: {
        ip_address: '192.168.1.88',
        device_type: 'router',
        manufacturer: 'TP-Link',
        model: null,
      },
    });
    bridgeEvents.emit('scan:done', {
      bridgeId: 'b1',
      tenantId,
      outletId,
      scanId,
      count: 1,
      errors: [],
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(service.getScan(scanId)!.status).toBe('done');
    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
      tenantId,
      null,
      expect.objectContaining({
        discovered_devices: expect.arrayContaining([
          expect.objectContaining({ device_id: 'confirmed-1', confirmed: true }),
          expect.objectContaining({ ip_address: '192.168.1.88' }),
        ]),
      }),
    );
  });
});
