import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscoveryService } from './discovery.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import type { TenantAutomationSettings, DiscoveredDevice } from '../settings/settings.interfaces';
import { DEFAULT_AUTOMATION_SETTINGS } from '../settings/settings.interfaces';

/**
 * Integration tests for Device Discovery end-to-end flow.
 *
 * Tests the full flow: device scan → confirm → auto-configure → health check.
 * Wires real DiscoveryService with mocked SettingsService and AuditService.
 *
 * Requirements: 10.1
 */

const TENANT_ID = 'tenant-discovery-001';
const OUTLET_ID = 'outlet-discovery-001';
const BAY_ID = 'bay-001';

function createMockCamera(): DiscoveredDevice {
  return {
    device_id: 'cam-001',
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
    discovered_at: new Date().toISOString(),
    confirmed_at: null,
  };
}

function createMockIoTController(): DiscoveredDevice {
  return {
    device_id: 'iot-001',
    ip_address: '192.168.1.200',
    device_type: 'iot_controller',
    manufacturer: 'Espressif',
    model: 'ESP32-WROOM',
    suggested_label: 'IoT Controller - Espressif',
    status: 'unconfigured',
    confirmed: false,
    assigned_bay_id: null,
    assigned_outlet_id: null,
    connection_params: {},
    discovered_at: new Date().toISOString(),
    confirmed_at: null,
  };
}

describe('Integration: Device Scan → Confirm → Auto-Configure → Health Check', () => {
  let discoveryService: DiscoveryService;
  let mockSettingsService: SettingsService;
  let mockAuditService: AuditService;
  let currentSettings: TenantAutomationSettings;

  beforeEach(() => {
    currentSettings = {
      ...DEFAULT_AUTOMATION_SETTINGS,
      discovered_devices: [createMockCamera(), createMockIoTController()],
    };

    mockSettingsService = {
      getSettings: vi.fn().mockImplementation(async () => ({ ...currentSettings })),
      updateSettings: vi.fn().mockImplementation(async (_tenantId: string, _userId: string, patch: Partial<TenantAutomationSettings>) => {
        // Simulate persisting the update
        if (patch.discovered_devices) {
          currentSettings.discovered_devices = patch.discovered_devices;
        }
        return currentSettings;
      }),
    } as unknown as SettingsService;

    mockAuditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    discoveryService = new DiscoveryService(mockSettingsService, mockAuditService);
  });

  describe('Network Scan', () => {
    it('should return discovered devices from the network scan', async () => {
      const result = await discoveryService.scanNetwork(TENANT_ID);

      // The scan completes and returns a result with timing info
      expect(result).toHaveProperty('devices');
      expect(result).toHaveProperty('scan_duration_ms');
      expect(result).toHaveProperty('errors');
      expect(result.scan_duration_ms).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.devices)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should audit-log the scan completion', async () => {
      await discoveryService.scanNetwork(TENANT_ID);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          operation: 'device_scan_completed',
          entityType: 'network_scan',
        }),
      );
    });
  });

  describe('Device Confirmation and Auto-Configuration', () => {
    it('should confirm a camera and auto-configure RTSP parameters', async () => {
      const confirmedDevice = await discoveryService.confirmDevice(TENANT_ID, {
        device_id: 'cam-001',
        assigned_outlet_id: OUTLET_ID,
        assigned_bay_id: BAY_ID,
      });

      // Device should be confirmed
      expect(confirmedDevice.confirmed).toBe(true);
      expect(confirmedDevice.assigned_outlet_id).toBe(OUTLET_ID);
      expect(confirmedDevice.assigned_bay_id).toBe(BAY_ID);
      expect(confirmedDevice.confirmed_at).not.toBeNull();
      expect(confirmedDevice.status).toBe('online');

      // RTSP auto-configuration should have been applied
      expect(confirmedDevice.connection_params).toHaveProperty('rtsp_url');
      expect(confirmedDevice.connection_params.rtsp_url).toBe('rtsp://192.168.1.100:554/stream');
      expect(confirmedDevice.connection_params).toHaveProperty('rtsp_port', 554);
      expect(confirmedDevice.connection_params).toHaveProperty('protocol', 'rtsp');
    });

    it('should confirm an IoT controller and auto-configure MQTT subscription', async () => {
      const confirmedDevice = await discoveryService.confirmDevice(TENANT_ID, {
        device_id: 'iot-001',
        assigned_outlet_id: OUTLET_ID,
      });

      // Device should be confirmed
      expect(confirmedDevice.confirmed).toBe(true);
      expect(confirmedDevice.assigned_outlet_id).toBe(OUTLET_ID);
      expect(confirmedDevice.status).toBe('online');

      // MQTT auto-configuration should have been applied
      expect(confirmedDevice.connection_params).toHaveProperty('mqtt_topic');
      expect(confirmedDevice.connection_params.mqtt_topic).toBe(
        `${TENANT_ID}/iot/iot-001/#`,
      );
      expect(confirmedDevice.connection_params).toHaveProperty('mqtt_port', 1883);
      expect(confirmedDevice.connection_params).toHaveProperty('protocol', 'mqtt');
    });

    it('should persist the confirmed device via SettingsService.updateSettings', async () => {
      await discoveryService.confirmDevice(TENANT_ID, {
        device_id: 'cam-001',
        assigned_outlet_id: OUTLET_ID,
        assigned_bay_id: BAY_ID,
      });

      // Verify updateSettings was called with the updated devices list
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        TENANT_ID,
        'system',
        expect.objectContaining({
          discovered_devices: expect.arrayContaining([
            expect.objectContaining({
              device_id: 'cam-001',
              confirmed: true,
              assigned_outlet_id: OUTLET_ID,
              assigned_bay_id: BAY_ID,
            }),
          ]),
        }),
      );
    });

    it('should audit-log the device confirmation', async () => {
      await discoveryService.confirmDevice(TENANT_ID, {
        device_id: 'cam-001',
        assigned_outlet_id: OUTLET_ID,
        assigned_bay_id: BAY_ID,
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          operation: 'device_confirmed',
          entityType: 'discovered_device',
          entityId: 'cam-001',
          afterValue: expect.objectContaining({
            device_type: 'camera',
            ip_address: '192.168.1.100',
            assigned_outlet_id: OUTLET_ID,
            assigned_bay_id: BAY_ID,
            auto_config_success: true,
          }),
        }),
      );
    });

    it('should still confirm a device even if auto-configuration fails', async () => {
      // Override autoconfigureCamera to throw an error
      vi.spyOn(discoveryService, 'autoconfigureCamera').mockRejectedValueOnce(
        new Error('RTSP port unreachable'),
      );

      const confirmedDevice = await discoveryService.confirmDevice(TENANT_ID, {
        device_id: 'cam-001',
        assigned_outlet_id: OUTLET_ID,
      });

      // Device is still confirmed
      expect(confirmedDevice.confirmed).toBe(true);
      expect(confirmedDevice.status).toBe('online');

      // Error is stored in connection_params for manual fallback
      expect(confirmedDevice.connection_params).toHaveProperty('auto_config_error');
      expect(confirmedDevice.connection_params.auto_config_error).toBe('RTSP port unreachable');
    });
  });

  describe('Health Check', () => {
    it('should check health of confirmed devices and return results', async () => {
      // First confirm a device so we have confirmed devices to check
      currentSettings.discovered_devices = [
        {
          ...createMockCamera(),
          confirmed: true,
          status: 'online',
          assigned_outlet_id: OUTLET_ID,
        },
      ];

      const results = await discoveryService.healthCheck(TENANT_ID);

      expect(results.length).toBe(1);
      expect(results[0]!.device_id).toBe('cam-001');
      expect(results[0]!).toHaveProperty('reachable');
      expect(results[0]!).toHaveProperty('latency_ms');
      expect(results[0]!).toHaveProperty('checked_at');
    });

    it('should update device status to offline when unreachable', async () => {
      currentSettings.discovered_devices = [
        {
          ...createMockCamera(),
          confirmed: true,
          status: 'online',
          assigned_outlet_id: OUTLET_ID,
        },
      ];

      // Mock pingDevice to return unreachable
      vi.spyOn(discoveryService, 'pingDevice').mockResolvedValue({
        reachable: false,
        latency_ms: null,
      });

      const results = await discoveryService.healthCheck(TENANT_ID);

      expect(results[0]!.reachable).toBe(false);

      // Settings should be updated with the offline status
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        TENANT_ID,
        'system',
        expect.objectContaining({
          discovered_devices: expect.arrayContaining([
            expect.objectContaining({
              device_id: 'cam-001',
              status: 'offline',
            }),
          ]),
        }),
      );
    });

    it('should skip health check if no confirmed devices exist', async () => {
      // All devices are unconfirmed
      currentSettings.discovered_devices = [createMockCamera()]; // confirmed: false

      const results = await discoveryService.healthCheck(TENANT_ID);

      expect(results.length).toBe(0);
      expect(mockSettingsService.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('Full Flow: Scan → Confirm → Auto-Configure → Health Check', () => {
    it('should complete the entire device lifecycle', async () => {
      // Step 1: Scan network (stub returns empty, but we verify the flow)
      const scanResult = await discoveryService.scanNetwork(TENANT_ID);
      expect(scanResult).toBeDefined();

      // Step 2: Confirm a discovered camera
      const confirmedCamera = await discoveryService.confirmDevice(TENANT_ID, {
        device_id: 'cam-001',
        assigned_outlet_id: OUTLET_ID,
        assigned_bay_id: BAY_ID,
      });
      expect(confirmedCamera.confirmed).toBe(true);
      expect(confirmedCamera.connection_params.rtsp_url).toBe('rtsp://192.168.1.100:554/stream');

      // Step 3: Verify auto-configuration happened (RTSP params set)
      expect(confirmedCamera.connection_params.protocol).toBe('rtsp');
      expect(confirmedCamera.connection_params.rtsp_port).toBe(554);

      // Step 4: Run health check on confirmed device
      // Update currentSettings to reflect the confirmed state
      currentSettings.discovered_devices = [confirmedCamera];

      const healthResults = await discoveryService.healthCheck(TENANT_ID);
      expect(healthResults.length).toBe(1);
      expect(healthResults[0]!.device_id).toBe('cam-001');
      expect(healthResults[0]!.reachable).toBe(true);
    });
  });
});
