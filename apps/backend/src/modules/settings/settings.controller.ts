import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Ip,
  UseGuards,
} from '@nestjs/common';
import { Role, JWTPayload } from '@aire/shared';
import { Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard, RlsContextGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import { SettingsService } from './settings.service';
import type { TenantAutomationSettings, PublicTenantSettings } from './settings.interfaces';

/**
 * Settings Controller.
 *
 * REST endpoints for managing per-tenant automation settings.
 * Applies RlsContextGuard for tenant scoping and RolesGuard for role checks.
 * Minimum role: Tenant_Owner (Platform_Super_Admin also has access via hierarchy).
 *
 * Requirements: 1.5, 12.2
 */
@Controller('api/settings')
@UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * GET /api/settings/:tenantId
   *
   * Retrieve automation settings for the tenant (decrypted for authorized user).
   * Returns the full TenantAutomationSettings object with sensitive fields decrypted.
   *
   * Requirement: 1.5, 12.3
   */
  @Get(':tenantId')
  async getSettings(
    @Param('tenantId') tenantId: string,
  ): Promise<PublicTenantSettings> {
    // Never return decrypted secrets to the client — only set/not-set flags.
    return this.settingsService.getPublicSettings(tenantId);
  }

  /**
   * PATCH /api/settings/:tenantId
   *
   * Partial update of automation settings for the tenant.
   * Validates the patch against JSON Schema, encrypts sensitive fields,
   * enforces prerequisite checks, and audit-logs the change.
   *
   * Only Tenant_Owner and Platform_Super_Admin can modify settings.
   *
   * Requirements: 1.3, 1.4, 1.5, 12.2
   */
  @Patch(':tenantId')
  @Roles(Role.TenantOwner)
  async updateSettings(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: JWTPayload,
    @Body() body: Partial<TenantAutomationSettings>,
    @Ip() ip: string,
  ): Promise<TenantAutomationSettings> {
    await this.settingsService.enforceOwnerRole(tenantId, user.sub);
    return this.settingsService.updateSettings(tenantId, user.sub, body, ip);
  }
}
