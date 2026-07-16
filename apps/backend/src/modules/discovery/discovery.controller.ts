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
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard, RlsContextGuard } from '../../common/guards';
import { DiscoveryService } from './discovery.service';
import { SettingsService } from '../settings/settings.service';
import type { DeviceConfirmation, DeviceHealthCheck, ScanSession } from './discovery.types';
import type { DiscoveredDevice } from '../settings/settings.interfaces';

/** Body for POST :tenantId/scan — the outlet whose bridge should run the scan. */
interface ScanRequest {
  outletId: string;
}

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
@UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * POST /api/discovery/:tenantId/scan
   *
   * Dispatch a LAN scan to the given outlet's bridge agent. Returns a scanId
   * immediately; devices stream in asynchronously — poll GET .../scan/:scanId.
   *
   * Requires: Tenant_Owner role
   * Requirements: 9.1, 9.4
   */
  @Post(':tenantId/scan')
  @Roles(Role.TenantOwner)
  async scanNetwork(
    @Param('tenantId') tenantId: string,
    @Body() body: ScanRequest,
  ): Promise<{ scanId: string }> {
    return this.discoveryService.scanNetwork(tenantId, body.outletId);
  }

  /**
   * GET /api/discovery/:tenantId/scan/:scanId
   *
   * Poll the progress of an in-flight scan: its status ('scanning' | 'done')
   * and the devices discovered so far.
   *
   * Requires: Tenant_Owner role
   * Requirements: 9.1, 9.4
   */
  @Get(':tenantId/scan/:scanId')
  @Roles(Role.TenantOwner)
  getScan(
    @Param('tenantId') _tenantId: string,
    @Param('scanId') scanId: string,
  ): ScanSession | null {
    return this.discoveryService.getScan(scanId);
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
      credentials: body.credentials,
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
