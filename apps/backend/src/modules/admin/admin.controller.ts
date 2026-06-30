import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@aire/shared';
import type { JWTPayload } from '@aire/shared';
import { Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import {
  AdminService,
  CreateTenantDto,
  UpdateTenantDto,
  TenantRecord,
  PlatformConfig,
} from './admin.service';
import { AdminMetricsService, MetricScope } from './admin-metrics.service';

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
  constructor(
    private readonly adminService: AdminService,
    private readonly metrics: AdminMetricsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ── Platform metrics & monitoring ───────────────────────────────────────────

  /** GET /api/admin/overview — platform-wide KPIs. */
  @Get('overview')
  async overview() {
    return this.metrics.getOverview();
  }

  /** GET /api/admin/tenants/enriched — tenants with rollups. */
  @Get('tenants/enriched')
  async tenantsEnriched() {
    return this.metrics.getTenantsEnriched();
  }

  /** GET /api/admin/tenants/:id/detail — single tenant detail. */
  @Get('tenants/:id/detail')
  async tenantDetail(@Param('id') id: string) {
    return this.metrics.getTenantDetail(id);
  }

  /** GET /api/admin/tenants/:id/branches — branches for the per-branch selector. */
  @Get('tenants/:id/branches')
  async tenantBranches(@Param('id') id: string) {
    return this.metrics.getBranches(id);
  }

  /** GET /api/admin/activity — recent platform-wide audit activity. */
  @Get('activity')
  async activity(@Query('limit') limit?: string) {
    return this.metrics.getActivity(limit ? parseInt(limit, 10) : 50);
  }

  /** GET /api/admin/ai-usage?scope=global|tenant|branch&tenantId=&outletId=&days= */
  @Get('ai-usage')
  async aiUsage(
    @Query('scope') scope: MetricScope = 'global',
    @Query('tenantId') tenantId?: string,
    @Query('outletId') outletId?: string,
    @Query('days') days?: string,
  ) {
    return this.metrics.getAiUsage({ scope, tenantId, outletId, windowDays: days ? parseInt(days, 10) : 30 });
  }

  /** GET /api/admin/monitoring?scope=global|tenant|branch&tenantId=&outletId=&days= */
  @Get('monitoring')
  async monitoring(
    @Query('scope') scope: MetricScope = 'global',
    @Query('tenantId') tenantId?: string,
    @Query('outletId') outletId?: string,
    @Query('days') days?: string,
  ) {
    return this.metrics.getOpsMonitoring({ scope, tenantId, outletId, windowDays: days ? parseInt(days, 10) : 30 });
  }

  /** POST /api/admin/tenants/:id/impersonate — act as the tenant's owner (audited). */
  @Post('tenants/:id/impersonate')
  async impersonate(@CurrentUser() admin: JWTPayload, @Param('id') id: string) {
    const result = await this.auth.issueImpersonationToken(id);
    await this.audit.log({
      tenantId: id,
      userId: admin.sub,
      operation: 'config_change',
      entityType: 'impersonation',
      entityId: id,
      beforeValue: { admin: admin.sub },
      afterValue: { impersonatedUser: result.user.id },
    });
    return result;
  }

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
