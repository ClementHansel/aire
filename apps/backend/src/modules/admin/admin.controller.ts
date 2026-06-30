import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@aire/shared';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import {
  AdminService,
  CreateTenantDto,
  UpdateTenantDto,
  TenantRecord,
  PlatformConfig,
} from './admin.service';

/**
 * Platform Admin Controller.
 *
 * All endpoints are restricted to Platform_Super_Admin role only.
 * Provides tenant management, platform configuration, and admin operations.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PlatformSuperAdmin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * GET /api/admin/tenants
   *
   * List all tenants with status, plan, and creation date.
   * Requirement: 4.1
   */
  @Get('tenants')
  async listTenants(): Promise<TenantRecord[]> {
    return this.adminService.listTenants();
  }

  /**
   * POST /api/admin/tenants
   *
   * Create a new tenant.
   * Requirement: 4.2
   */
  @Post('tenants')
  async createTenant(@Body() dto: CreateTenantDto): Promise<TenantRecord> {
    return this.adminService.createTenant(dto);
  }

  /**
   * PUT /api/admin/tenants/:id
   *
   * Edit an existing tenant.
   * Requirement: 4.2
   */
  @Put('tenants/:id')
  async updateTenant(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantRecord> {
    return this.adminService.updateTenant(id, dto);
  }

  /**
   * PATCH /api/admin/tenants/:id/suspend
   *
   * Suspend a tenant.
   * Requirement: 4.2
   */
  @Patch('tenants/:id/suspend')
  async suspendTenant(@Param('id') id: string): Promise<TenantRecord> {
    return this.adminService.suspendTenant(id);
  }

  /**
   * PATCH /api/admin/tenants/:id/reactivate
   *
   * Reactivate a suspended tenant.
   * Requirement: 4.2
   */
  @Patch('tenants/:id/reactivate')
  async reactivateTenant(@Param('id') id: string): Promise<TenantRecord> {
    return this.adminService.reactivateTenant(id);
  }

  /**
   * GET /api/admin/config
   *
   * Get platform configuration (default plans, pricing tiers, feature flags).
   * Requirement: 4.3
   */
  @Get('config')
  async getPlatformConfig(): Promise<PlatformConfig> {
    return this.adminService.getPlatformConfig();
  }

  /**
   * PUT /api/admin/config
   *
   * Update platform configuration.
   * Requirement: 4.3
   */
  @Put('config')
  async updatePlatformConfig(
    @Body() config: Partial<PlatformConfig>,
  ): Promise<PlatformConfig> {
    return this.adminService.updatePlatformConfig(config);
  }
}
