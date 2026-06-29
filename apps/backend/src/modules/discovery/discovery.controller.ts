import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@aire/shared';
import { Roles } from '../../common/decorators';
import { RolesGuard, RlsContextGuard } from '../../common/guards';
import { DiscoveryService } from './discovery.service';
import { SettingsService } from '../settings/settings.service';
import type { NetworkScanResult, DeviceConfirmation, DeviceHealthCheck } from './discovery.types';
import type { DiscoveredDevice } from '../settings/settings.interfaces';

/**
 * Discovery Controller.
 *
 * REST endpoints for network device discovery, confirmation, and health monitoring.
 * Applies RlsContextGuard for tenant scoping and RolesGuard for role checks.
 *
 * - Scan and confirm operations require Tenant_Owner role (write operations).
 * - Device listing and health checks are available to Tenant_Owner.
 *
 * Requirements: 9.4, 9.5
 */
@Controller('api/discovery')
@UseGuards(RlsContextGuard, RolesGuard)
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * POST /api/discovery/:tenantId/scan
   *
   * Initiate a network scan for the tenant's local network.
   * Discovers ONVIF cameras, MQTT IoT controllers, and SSDP/mDNS routers.
   * Returns partial results if individual protocol scans fail.
   *
   * Requires: Tenant_Owner role
   * Requirements: 9.1, 9.4
   */
  @Post(':tenantId/scan')
  @Roles(Role.TenantOwner)
  async scanNetwork(
    @Param('tenantId') tenantId: string,
  ): Promise<NetworkScanResult> {
    return this.discoveryService.scanNetwork(tenantId);
  }

  /**
   * GET /api/discovery/:tenantId/devices
   *
   * List all discovered and confirmed devices for the tenant.
   * Returns the discovered_devices array from tenant settings.
   *
   * Requires: Tenant_Owner role
   * Requirements: 9.4, 9.5
   */
  @Get(':tenantId/devices')
  @Roles(Role.TenantOwner)
  async listDevices(
    @Param('tenantId') tenantId: string,
  ): Promise<DiscoveredDevice[]> {
    const settings = await this.settingsService.getSettings(tenantId);
    return settings.discovered_devices;
  }

  /**
   * POST /api/discovery/:tenantId/devices/:deviceId/confirm
   *
   * Confirm a discovered device and assign it to a bay/outlet.
   * Triggers auto-configuration (RTSP for cameras, MQTT for IoT controllers).
   *
   * Requires: Tenant_Owner role
   * Requirements: 9.5, 10.1, 10.2, 10.3
   */
  @Post(':tenantId/devices/:deviceId/confirm')
  @Roles(Role.TenantOwner)
  async confirmDevice(
    @Param('tenantId') tenantId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: Omit<DeviceConfirmation, 'device_id'>,
  ): Promise<DiscoveredDevice> {
    const confirmation: DeviceConfirmation = {
      device_id: deviceId,
      assigned_outlet_id: body.assigned_outlet_id,
      assigned_bay_id: body.assigned_bay_id,
    };
    return this.discoveryService.confirmDevice(tenantId, confirmation);
  }

  /**
   * GET /api/discovery/:tenantId/devices/:deviceId/health
   *
   * Get health status for a specific confirmed device.
   * Performs a health check on all confirmed devices and returns the result
   * for the specified device.
   *
   * Requires: Tenant_Owner role
   * Requirements: 9.6, 10.6
   */
  @Get(':tenantId/devices/:deviceId/health')
  @Roles(Role.TenantOwner)
  async getDeviceHealth(
    @Param('tenantId') tenantId: string,
    @Param('deviceId') deviceId: string,
  ): Promise<DeviceHealthCheck | null> {
    const results = await this.discoveryService.healthCheck(tenantId);
    return results.find((r) => r.device_id === deviceId) ?? null;
  }
}
