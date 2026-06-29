import { Injectable, Logger, NotFoundException, Optional, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DiscoveredDevice } from '../settings/settings.interfaces';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import {
  NetworkScanResult,
  ScanError,
  DeviceConfirmation,
  DeviceHealthCheck,
  DiscoveryProtocol,
} from './discovery.types';

/**
 * Device Discovery Service.
 *
 * Handles network scanning (ONVIF, MQTT, SSDP/mDNS), device registration,
 * auto-configuration, and health monitoring for tenant networks.
 *
 * Requirements: 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.5
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    @Optional() @Inject(SettingsService) private readonly settingsService?: SettingsService,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
  ) {}

  /**
   * Perform a full network scan using ONVIF, MQTT broker, and SSDP/mDNS protocols.
   *
   * Each protocol scan runs independently. If an individual protocol fails,
   * the error is captured and scanning continues with remaining protocols.
   * Returns partial results with error details.
   *
   * Requirements: 9.1, 9.2, 9.3
   */
  async scanNetwork(tenantId: string): Promise<NetworkScanResult> {
    const startTime = Date.now();
    const devices: DiscoveredDevice[] = [];
    const errors: ScanError[] = [];

    this.logger.log(`Starting network scan for tenant ${tenantId}`);

    // Run all protocol scans concurrently, capturing partial results
    const scanResults = await Promise.allSettled([
      this.scanOnvif(),
      this.scanMqttBrokers(),
      this.scanSsdpMdns(),
    ]);

    // Process ONVIF results
    this.processProtocolResult(scanResults[0]!, 'onvif', devices, errors);

    // Process MQTT results
    this.processProtocolResult(scanResults[1]!, 'mqtt', devices, errors);

    // Process SSDP/mDNS results
    this.processProtocolResult(scanResults[2]!, 'ssdp', devices, errors);

    const scanDuration = Date.now() - startTime;

    this.logger.log(
      `Network scan for tenant ${tenantId} completed in ${scanDuration}ms. ` +
        `Found ${devices.length} device(s), ${errors.length} error(s).`,
    );

    // Audit-log the scan completion
    if (this.auditService) {
      await this.auditService.log({
        tenantId,
        userId: 'system',
        operation: 'device_scan_completed',
        entityType: 'network_scan',
        afterValue: {
          devices_found: devices.length,
          scan_duration_ms: scanDuration,
          errors: errors.length > 0 ? errors : undefined,
        },
      });
    }

    return {
      devices,
      scan_duration_ms: scanDuration,
      errors,
    };
  }

  /**
   * Generate a suggested human-readable label from device type and manufacturer.
   *
   * Format: "{DeviceTypeLabel} - {Manufacturer}" or "{DeviceTypeLabel} - Unknown"
   * when manufacturer is not available.
   *
   * Requirement: 9.3
   */
  generateSuggestedLabel(
    deviceType: DiscoveredDevice['device_type'],
    manufacturer: string | null,
  ): string {
    const typeLabels: Record<DiscoveredDevice['device_type'], string> = {
      camera: 'Camera',
      iot_controller: 'IoT Controller',
      router: 'Router',
    };

    const typeLabel = typeLabels[deviceType];
    const mfgLabel = manufacturer && manufacturer.trim() ? manufacturer.trim() : 'Unknown';

    return `${typeLabel} - ${mfgLabel}`;
  }

  /**
   * Process the result of a single protocol scan.
   * On success, adds devices to the list. On failure, adds error details.
   */
  private processProtocolResult(
    result: PromiseSettledResult<DiscoveredDevice[]>,
    protocol: DiscoveryProtocol,
    devices: DiscoveredDevice[],
    errors: ScanError[],
  ): void {
    if (result.status === 'fulfilled') {
      devices.push(...result.value);
    } else {
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      errors.push({ protocol, message: errorMessage });
      this.logger.warn(`${protocol.toUpperCase()} scan failed: ${errorMessage}`);
    }
  }

  /**
   * Perform ONVIF WS-Discovery probe for IP cameras on the local network.
   *
   * Stub implementation — in production this would use ONVIF WS-Discovery
   * (SOAP over UDP multicast to 239.255.255.250:3702).
   */
  private async scanOnvif(): Promise<DiscoveredDevice[]> {
    // Stub: In production, this would perform ONVIF WS-Discovery probe
    // using multicast to discover IP cameras on the network.
    this.logger.debug('Performing ONVIF WS-Discovery probe...');

    // Return empty array — real implementation would discover cameras
    return [];
  }

  /**
   * Scan for MQTT brokers and connected IoT controllers.
   *
   * Stub implementation — in production this would attempt connections
   * to common MQTT ports (1883, 8883) on local subnet hosts.
   */
  private async scanMqttBrokers(): Promise<DiscoveredDevice[]> {
    // Stub: In production, this would scan for MQTT brokers
    // and enumerate connected IoT controllers.
    this.logger.debug('Scanning for MQTT brokers...');

    // Return empty array — real implementation would discover IoT devices
    return [];
  }

  /**
   * Perform SSDP/mDNS discovery for routers and network infrastructure.
   *
   * Stub implementation — in production this would send SSDP M-SEARCH
   * requests and mDNS queries to discover network devices.
   */
  private async scanSsdpMdns(): Promise<DiscoveredDevice[]> {
    // Stub: In production, this would perform SSDP M-SEARCH over UDP
    // multicast (239.255.255.250:1900) and mDNS queries.
    this.logger.debug('Performing SSDP/mDNS discovery...');

    // Return empty array — real implementation would discover routers
    return [];
  }

  /**
   * Create a DiscoveredDevice record with a generated ID and label.
   * Utility method for protocol scanners to use when they find a device.
   */
  createDeviceRecord(params: {
    ip_address: string;
    device_type: DiscoveredDevice['device_type'];
    manufacturer: string | null;
    model: string | null;
    connection_params?: Record<string, unknown>;
  }): DiscoveredDevice {
    return {
      device_id: uuidv4(),
      ip_address: params.ip_address,
      device_type: params.device_type,
      manufacturer: params.manufacturer,
      model: params.model,
      suggested_label: this.generateSuggestedLabel(
        params.device_type,
        params.manufacturer,
      ),
      status: 'unconfigured',
      confirmed: false,
      assigned_bay_id: null,
      assigned_outlet_id: null,
      connection_params: params.connection_params ?? {},
      discovered_at: new Date().toISOString(),
      confirmed_at: null,
    };
  }

  /**
   * Confirm a discovered device, assign it to a bay/outlet, and trigger auto-configuration.
   *
   * Finds the device in the tenant's discovered_devices by device_id, sets
   * confirmed=true, assigns bay/outlet, triggers type-specific auto-configuration,
   * and updates the device in Tenant_Settings via SettingsService.
   *
   * If auto-configuration fails, the device is still confirmed but an error is
   * stored in connection_params.auto_config_error for manual fallback.
   *
   * Requirements: 10.1, 10.2, 10.3, 10.5
   */
  async confirmDevice(
    tenantId: string,
    confirmation: DeviceConfirmation,
  ): Promise<DiscoveredDevice> {
    if (!this.settingsService) {
      throw new Error('SettingsService is required for device confirmation');
    }

    // 1. Get current settings and find the device
    const settings = await this.settingsService.getSettings(tenantId);
    const deviceIndex = settings.discovered_devices.findIndex(
      (d) => d.device_id === confirmation.device_id,
    );

    if (deviceIndex === -1) {
      throw new NotFoundException(
        `Device ${confirmation.device_id} not found in tenant's discovered devices`,
      );
    }

    // 2. Update device confirmation fields
    const device = { ...settings.discovered_devices[deviceIndex]! };
    device.confirmed = true;
    device.assigned_outlet_id = confirmation.assigned_outlet_id;
    device.assigned_bay_id = confirmation.assigned_bay_id ?? null;
    device.confirmed_at = new Date().toISOString();
    device.status = 'online';

    // 3. Trigger auto-configuration based on device type
    let autoConfigSuccess = true;
    let autoConfigError: string | undefined;
    try {
      await this.autoconfigure(device, tenantId);
    } catch (error) {
      // On failure, still confirm the device but record the auto-config error
      autoConfigSuccess = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      autoConfigError = errorMessage;
      device.connection_params = {
        ...device.connection_params,
        auto_config_error: errorMessage,
      };
      this.logger.warn(
        `Auto-configuration failed for device ${device.device_id}: ${errorMessage}`,
      );
    }

    // 4. Update the device in the discovered_devices array
    const updatedDevices = [...settings.discovered_devices];
    updatedDevices[deviceIndex] = device;

    // 5. Persist via SettingsService (using a system user ID for internal operations)
    await this.settingsService!.updateSettings(tenantId, 'system', {
      discovered_devices: updatedDevices,
    });

    // 6. Audit-log the device confirmation
    if (this.auditService) {
      await this.auditService.log({
        tenantId,
        userId: 'system',
        operation: 'device_confirmed',
        entityType: 'discovered_device',
        entityId: device.device_id,
        afterValue: {
          device_type: device.device_type,
          ip_address: device.ip_address,
          assigned_outlet_id: device.assigned_outlet_id,
          assigned_bay_id: device.assigned_bay_id,
          auto_config_success: autoConfigSuccess,
          auto_config_error: autoConfigError,
        },
      });

      // Audit-log auto-configuration failure separately for visibility
      if (!autoConfigSuccess) {
        await this.auditService.log({
          tenantId,
          userId: 'system',
          operation: 'device_auto_config_failed',
          entityType: 'discovered_device',
          entityId: device.device_id,
          afterValue: {
            device_type: device.device_type,
            ip_address: device.ip_address,
            error: autoConfigError,
          },
        });
      }
    }

    this.logger.log(
      `Device ${device.device_id} confirmed for tenant ${tenantId} ` +
        `(type: ${device.device_type}, outlet: ${device.assigned_outlet_id})`,
    );

    return device;
  }

  /**
   * Route auto-configuration to the appropriate handler based on device type.
   */
  private async autoconfigure(
    device: DiscoveredDevice,
    tenantId: string,
  ): Promise<void> {
    switch (device.device_type) {
      case 'camera':
        await this.autoconfigureCamera(device);
        break;
      case 'iot_controller':
        await this.autoconfigureIoT(device, tenantId);
        break;
      case 'router':
        // Routers don't require auto-configuration beyond discovery
        this.logger.debug(
          `Router ${device.device_id} confirmed — no auto-configuration needed`,
        );
        break;
    }
  }

  /**
   * Perform a health check on all confirmed devices for a tenant.
   *
   * Pings each confirmed device to check reachability, updates device status
   * (online/offline), persists changes via SettingsService, and logs a warning
   * when a device goes offline.
   *
   * Requirements: 9.6, 10.6
   */
  async healthCheck(tenantId: string): Promise<DeviceHealthCheck[]> {
    if (!this.settingsService) {
      throw new Error('SettingsService is required for health checks');
    }

    const settings = await this.settingsService.getSettings(tenantId);
    const confirmedDevices = settings.discovered_devices.filter((d) => d.confirmed);

    if (confirmedDevices.length === 0) {
      this.logger.debug(`No confirmed devices for tenant ${tenantId}, skipping health check`);
      return [];
    }

    const results: DeviceHealthCheck[] = [];
    let statusChanged = false;

    for (const device of confirmedDevices) {
      const checkResult = await this.pingDevice(device.ip_address);
      const healthCheck: DeviceHealthCheck = {
        device_id: device.device_id,
        reachable: checkResult.reachable,
        latency_ms: checkResult.latency_ms,
        checked_at: new Date().toISOString(),
      };
      results.push(healthCheck);

      // Determine new status based on reachability
      const newStatus: DiscoveredDevice['status'] = checkResult.reachable ? 'online' : 'offline';

      if (device.status !== newStatus) {
        statusChanged = true;
        // Update device status in the array
        const deviceIndex = settings.discovered_devices.findIndex(
          (d) => d.device_id === device.device_id,
        );
        if (deviceIndex !== -1) {
          settings.discovered_devices[deviceIndex] = {
            ...settings.discovered_devices[deviceIndex]!,
            status: newStatus,
          };
        }

        if (newStatus === 'offline') {
          this.logger.warn(
            `Device ${device.device_id} (${device.suggested_label}) went offline ` +
              `for tenant ${tenantId}. IP: ${device.ip_address}`,
          );
          // TODO: Notify Tenant_Owner via Settings UI WebSocket when device goes offline
        }
      }
    }

    // Persist updated statuses if any changed
    if (statusChanged) {
      await this.settingsService.updateSettings(tenantId, 'system', {
        discovered_devices: settings.discovered_devices,
      });
    }

    this.logger.log(
      `Health check for tenant ${tenantId}: ${results.length} device(s) checked, ` +
        `${results.filter((r) => r.reachable).length} online, ` +
        `${results.filter((r) => !r.reachable).length} offline`,
    );

    return results;
  }

  /**
   * Detect IP address changes for confirmed devices by re-scanning the network
   * and comparing results with stored device configurations.
   *
   * Matches discovered devices with confirmed devices by manufacturer+model or device_id.
   * If a confirmed device's IP has changed, updates the stored IP and persists the change.
   *
   * Requirements: 10.4
   */
  async detectIPChanges(
    tenantId: string,
  ): Promise<{ deviceId: string; oldIp: string; newIp: string }[]> {
    if (!this.settingsService) {
      throw new Error('SettingsService is required for IP change detection');
    }

    const settings = await this.settingsService.getSettings(tenantId);
    const confirmedDevices = settings.discovered_devices.filter((d) => d.confirmed);

    if (confirmedDevices.length === 0) {
      this.logger.debug(
        `No confirmed devices for tenant ${tenantId}, skipping IP change detection`,
      );
      return [];
    }

    // Re-scan the network
    const scanResult = await this.scanNetwork(tenantId);
    const changes: { deviceId: string; oldIp: string; newIp: string }[] = [];

    // For each discovered device, try to match with a confirmed device
    for (const discoveredDevice of scanResult.devices) {
      const matchedDevice = confirmedDevices.find((confirmed) => {
        // Match by device_id first (most reliable)
        if (confirmed.device_id === discoveredDevice.device_id) {
          return true;
        }
        // Match by manufacturer+model combination as fallback
        if (
          confirmed.manufacturer &&
          confirmed.model &&
          confirmed.manufacturer === discoveredDevice.manufacturer &&
          confirmed.model === discoveredDevice.model
        ) {
          return true;
        }
        return false;
      });

      if (matchedDevice && matchedDevice.ip_address !== discoveredDevice.ip_address) {
        const oldIp = matchedDevice.ip_address;
        const newIp = discoveredDevice.ip_address;

        // Update the device's IP in settings
        const deviceIndex = settings.discovered_devices.findIndex(
          (d) => d.device_id === matchedDevice.device_id,
        );
        if (deviceIndex !== -1) {
          settings.discovered_devices[deviceIndex] = {
            ...settings.discovered_devices[deviceIndex]!,
            ip_address: newIp,
          };
        }

        changes.push({
          deviceId: matchedDevice.device_id,
          oldIp,
          newIp,
        });

        this.logger.log(
          `IP change detected for device ${matchedDevice.device_id} ` +
            `(${matchedDevice.suggested_label}) in tenant ${tenantId}: ` +
            `${oldIp} → ${newIp}`,
        );
      }
    }

    // Persist updated IPs if any changed
    if (changes.length > 0) {
      await this.settingsService.updateSettings(tenantId, 'system', {
        discovered_devices: settings.discovered_devices,
      });

      // Audit-log each IP change
      if (this.auditService) {
        for (const change of changes) {
          await this.auditService.log({
            tenantId,
            userId: 'system',
            operation: 'device_ip_changed',
            entityType: 'discovered_device',
            entityId: change.deviceId,
            beforeValue: { ip_address: change.oldIp },
            afterValue: { ip_address: change.newIp },
          });
        }
      }
    }

    return changes;
  }

  /**
   * Ping a device to check reachability.
   *
   * Stub implementation — in production this would perform an actual ICMP ping
   * or TCP connect check to the device's IP address.
   *
   * This method is designed to be easily mocked in tests.
   */
  async pingDevice(ip: string): Promise<{ reachable: boolean; latency_ms: number | null }> {
    // Stub: always returns reachable with simulated latency
    // In production, this would perform an actual network ping
    this.logger.debug(`Pinging device at ${ip}...`);
    return { reachable: true, latency_ms: Math.floor(Math.random() * 50) + 1 };
  }

  /**
   * Auto-configure a confirmed camera device by setting up RTSP stream capture.
   *
   * Stores the RTSP URL connection parameters based on the camera's IP address.
   * In production, this would validate the RTSP endpoint and initiate stream capture.
   *
   * Requirement: 10.1
   */
  async autoconfigureCamera(device: DiscoveredDevice): Promise<void> {
    this.logger.log(
      `Configuring RTSP stream capture for camera ${device.device_id} at ${device.ip_address}`,
    );

    // Set up RTSP connection params based on discovered IP
    const rtspUrl = `rtsp://${device.ip_address}:554/stream`;

    device.connection_params = {
      ...device.connection_params,
      rtsp_url: rtspUrl,
      rtsp_port: 554,
      stream_path: '/stream',
      protocol: 'rtsp',
      configured_at: new Date().toISOString(),
    };

    this.logger.log(
      `RTSP stream configured for camera ${device.device_id}: ${rtspUrl}`,
    );
  }

  /**
   * Auto-configure a confirmed IoT controller device by subscribing to MQTT topics.
   *
   * Stores the MQTT topic subscription information in the device's connection_params.
   * In production, this would establish an actual MQTT subscription.
   *
   * Requirement: 10.2
   */
  async autoconfigureIoT(
    device: DiscoveredDevice,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(
      `Configuring MQTT subscription for IoT controller ${device.device_id} at ${device.ip_address}`,
    );

    // Set up MQTT topic subscription based on tenant and device
    const baseTopic = `${tenantId}/iot/${device.device_id}/#`;

    device.connection_params = {
      ...device.connection_params,
      mqtt_topic: baseTopic,
      mqtt_broker_ip: device.ip_address,
      mqtt_port: 1883,
      protocol: 'mqtt',
      configured_at: new Date().toISOString(),
    };

    this.logger.log(
      `MQTT topic subscription configured for IoT controller ${device.device_id}: ${baseTopic}`,
    );
  }
}
