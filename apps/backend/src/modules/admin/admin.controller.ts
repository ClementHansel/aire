import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  Logger,
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
import { DockerService } from './docker.service';
import {
  PlatformPlanService,
  CreatePlatformPlanDto,
  UpdatePlatformPlanDto,
} from './platform-plan.service';
import { PlatformInvoiceService, InvoiceStatus } from './platform-invoice.service';
import { PlatformUserService, CreatePlatformUserDto } from './platform-user.service';
import { PlatformAnnouncementService, CreateAnnouncementDto } from './platform-announcement.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PlatformOpsService, OpsSeverity } from './platform-ops.service';
import { PlatformTaxService, PlatformTaxConfig } from './platform-tax.service';
import { PlatformChatService } from './platform-chat.service';
import { EntitlementService } from '../entitlement';
import { JobMonitorService } from '../job-monitor';
import { AgentConfigService } from '../agent-config/agent-config.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Admin Controller.
 *
 * Role-aware: a Platform_Super_Admin sees platform-wide data and may pick any
 * tenant/branch; a Tenant_Owner is always confined to their own tenant and its
 * branches (the controller overrides any requested tenantId/scope). Platform-only
 * actions (tenant CRUD, impersonation, module toggles, platform config writes)
 * remain super-admin only.
 */
@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly metrics: AdminMetricsService,
    private readonly docker: DockerService,
    private readonly plans: PlatformPlanService,
    private readonly invoices: PlatformInvoiceService,
    private readonly platformUsers: PlatformUserService,
    private readonly announcements: PlatformAnnouncementService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly entitlements: EntitlementService,
    private readonly ops: PlatformOpsService,
    private readonly tax: PlatformTaxService,
    private readonly jobs: JobMonitorService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly agentConfig: AgentConfigService,
    private readonly settings: SettingsService,
    private readonly aiConsole: PlatformChatService,
  ) {}

  /** Super-admin may target any tenant (or all); a tenant owner is pinned to their own. */
  private effTenantId(user: JWTPayload, requested?: string): string | undefined {
    return user.role === Role.PlatformSuperAdmin ? requested : user.tenant_id;
  }

  /**
   * Like {@link effTenantId} but resolves a slug (or UUID) in the URL to the
   * canonical tenant UUID. Admin tenant URLs use the slug, so `:id` routes pass
   * the raw param through here before hitting the data layer.
   */
  private async effTenantIdResolved(user: JWTPayload, requested?: string): Promise<string | undefined> {
    const raw = this.effTenantId(user, requested);
    return raw ? this.adminService.resolveTenantId(raw) : raw;
  }

  /** A tenant owner can never use 'global' scope; everything else passes through. */
  private effScope(user: JWTPayload, requested: MetricScope): MetricScope {
    if (user.role === Role.PlatformSuperAdmin) return requested;
    return requested === 'branch' ? 'branch' : 'tenant';
  }

  // ── Platform AI console ─────────────────────────────────────────────────────
  // Super-admin only: the assistant reads ACROSS tenants, so a tenant owner must
  // never reach it (the class-level @Roles allows owners for the metrics routes).

  /** POST /api/admin/ai/chat — one turn with the cross-tenant platform analyst. */
  @Post('ai/chat')
  @Roles(Role.PlatformSuperAdmin)
  async platformChat(
    @CurrentUser() user: JWTPayload,
    @Body() body: { message: string; sessionId?: string },
  ) {
    if (!body?.message?.trim()) throw new BadRequestException('message is required');
    return this.aiConsole.chat(user.sub, body.sessionId ?? null, body.message.trim());
  }

  /** GET /api/admin/ai/chat/sessions — the admin's threads. */
  @Get('ai/chat/sessions')
  @Roles(Role.PlatformSuperAdmin)
  async platformChatSessions(@CurrentUser() user: JWTPayload) {
    return this.aiConsole.listSessions(user.sub);
  }

  /** POST /api/admin/ai/chat/sessions — start an empty thread. */
  @Post('ai/chat/sessions')
  @Roles(Role.PlatformSuperAdmin)
  async createPlatformChatSession(@CurrentUser() user: JWTPayload) {
    const id = await this.aiConsole.createSession(user.sub);
    return { id, title: 'New chat' };
  }

  /** GET /api/admin/ai/chat/sessions/:id — messages in a thread. */
  @Get('ai/chat/sessions/:id')
  @Roles(Role.PlatformSuperAdmin)
  async platformChatMessages(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.aiConsole.getMessages(user.sub, id);
  }

  /** PATCH /api/admin/ai/chat/sessions/:id — rename and/or pin a thread. */
  @Patch('ai/chat/sessions/:id')
  @Roles(Role.PlatformSuperAdmin)
  async updatePlatformChatSession(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { title?: string; pinned?: boolean },
  ) {
    if (body?.pinned !== undefined) {
      const ok = await this.aiConsole.setPinned(user.sub, id, !!body.pinned);
      if (!ok) throw new BadRequestException('Chat session not found');
    }
    if (body?.title !== undefined) {
      if (!body.title.trim()) throw new BadRequestException('title cannot be empty');
      const renamed = await this.aiConsole.renameSession(user.sub, id, body.title);
      if (!renamed) throw new BadRequestException('Chat session not found');
      return renamed;
    }
    return { id };
  }

  /** DELETE /api/admin/ai/chat/sessions/:id — archive a thread. */
  @Delete('ai/chat/sessions/:id')
  @Roles(Role.PlatformSuperAdmin)
  async deletePlatformChatSession(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    const ok = await this.aiConsole.archiveSession(user.sub, id);
    if (!ok) throw new BadRequestException('Chat session not found');
    return { deleted: true };
  }

  /** GET /api/admin/ai/chat/tools — what the platform assistant can see. */
  @Get('ai/chat/tools')
  @Roles(Role.PlatformSuperAdmin)
  platformChatTools() {
    return this.aiConsole.listTools();
  }

  // ── Platform metrics & monitoring ───────────────────────────────────────────

  /** GET /api/admin/overview — KPIs (platform-wide for super; own tenant for owner). */
  @Get('overview')
  async overview(@CurrentUser() user: JWTPayload) {
    return this.metrics.getOverview(this.effTenantId(user));
  }

  /** GET /api/admin/tenants/enriched — tenants with rollups (own tenant only for owner). */
  @Get('tenants/enriched')
  async tenantsEnriched(@CurrentUser() user: JWTPayload) {
    return this.metrics.getTenantsEnriched(this.effTenantId(user));
  }

  /** GET /api/admin/tenants/:id/detail — single tenant detail (owner forced to own). */
  @Get('tenants/:id/detail')
  async tenantDetail(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.metrics.getTenantDetail((await this.effTenantIdResolved(user, id))!);
  }

  /** GET /api/admin/tenants/:id/branches — branches for the selector (owner forced to own). */
  @Get('tenants/:id/branches')
  async tenantBranches(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.metrics.getBranches((await this.effTenantIdResolved(user, id))!);
  }

  /** GET /api/admin/activity — recent audit activity (own tenant only for owner). */
  @Get('activity')
  async activity(@CurrentUser() user: JWTPayload, @Query('limit') limit?: string) {
    return this.metrics.getActivity(limit ? parseInt(limit, 10) : 50, this.effTenantId(user));
  }

  /** GET /api/admin/timeseries?days= — revenue series (own tenant only for owner). */
  @Get('timeseries')
  async timeseries(@CurrentUser() user: JWTPayload, @Query('days') days?: string) {
    return this.metrics.getTimeseries(days ? parseInt(days, 10) : 30, this.effTenantId(user));
  }

  /** GET /api/admin/health — DB/WAHA reachability + counts (own tenant counts for owner). */
  @Get('health')
  async health(@CurrentUser() user: JWTPayload) {
    return this.metrics.getHealth(this.effTenantId(user));
  }

  /** GET /api/admin/health/containers — Docker container status (super-admin only). */
  @Get('health/containers')
  @Roles(Role.PlatformSuperAdmin)
  async healthContainers() {
    if (!(await this.docker.available())) return { available: false, containers: [] };
    return { available: true, containers: await this.docker.listContainers() };
  }

  /** GET /api/admin/health/containers/:id/logs?tail= — container logs (super-admin only). */
  @Get('health/containers/:id/logs')
  @Roles(Role.PlatformSuperAdmin)
  async containerLogs(@Param('id') id: string, @Query('tail') tail?: string) {
    return { logs: await this.docker.containerLogs(id, tail ? parseInt(tail, 10) : 200) };
  }

  /** GET /api/admin/ai-usage?scope=&tenantId=&outletId=&days= (owner scoped to own tenant). */
  @Get('ai-usage')
  async aiUsage(
    @CurrentUser() user: JWTPayload,
    @Query('scope') scope: MetricScope = 'global',
    @Query('tenantId') tenantId?: string,
    @Query('outletId') outletId?: string,
    @Query('days') days?: string,
  ) {
    return this.metrics.getAiUsage({
      scope: this.effScope(user, scope),
      tenantId: this.effTenantId(user, tenantId),
      outletId,
      windowDays: days ? parseInt(days, 10) : 30,
    });
  }

  /** GET /api/admin/monitoring?scope=&tenantId=&outletId=&days= (owner scoped to own tenant). */
  @Get('monitoring')
  async monitoring(
    @CurrentUser() user: JWTPayload,
    @Query('scope') scope: MetricScope = 'global',
    @Query('tenantId') tenantId?: string,
    @Query('outletId') outletId?: string,
    @Query('days') days?: string,
  ) {
    return this.metrics.getOpsMonitoring({
      scope: this.effScope(user, scope),
      tenantId: this.effTenantId(user, tenantId),
      outletId,
      windowDays: days ? parseInt(days, 10) : 30,
    });
  }

  /**
   * POST /api/admin/tenants/:id/impersonate — super-admin only (audited).
   * `as: 'owner'` (default) issues the tenant-owner token (business dashboard POV);
   * `as: 'employee'` issues a staff token for a real employee (self-service /employee
   * POV), optionally targeting a specific `targetId` (employee id).
   */
  @Post('tenants/:id/impersonate')
  @Roles(Role.PlatformSuperAdmin)
  async impersonate(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: { as?: 'owner' | 'employee'; targetId?: string } = {},
  ) {
    const tenantId = await this.adminService.resolveTenantId(id);
    const result =
      body.as === 'employee'
        ? await this.auth.issueEmployeeImpersonationToken(tenantId, body.targetId)
        : await this.auth.issueImpersonationToken(tenantId);
    await this.audit.log({
      tenantId,
      userId: admin.sub,
      operation: 'config_change',
      entityType: 'impersonation',
      entityId: tenantId,
      beforeValue: { admin: admin.sub },
      afterValue: { impersonatedUser: result.user.id, as: body.as ?? 'owner' },
    });
    return result;
  }

  /**
   * GET /api/admin/tenants/:id/pov-targets — super-admin only. Employees (with a
   * login) + customers of the tenant, to populate the hub "view as" pickers.
   */
  @Get('tenants/:id/pov-targets')
  @Roles(Role.PlatformSuperAdmin)
  async povTargets(@Param('id') id: string) {
    const tenantId = await this.adminService.resolveTenantId(id);
    return this.adminService.listPovTargets(tenantId);
  }

  /**
   * POST /api/admin/tenants/:id/portal-token — super-admin only (audited). Mints a
   * customer-portal token to view the customer/member portal in a real customer's
   * POV. Optional `targetId` (customer id); defaults to the most recent customer.
   */
  @Post('tenants/:id/portal-token')
  @Roles(Role.PlatformSuperAdmin)
  async portalToken(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: { targetId?: string } = {},
  ) {
    const tenantId = await this.adminService.resolveTenantId(id);
    const result = await this.auth.issueCustomerPreviewToken(tenantId, body.targetId);
    await this.audit.log({
      tenantId,
      userId: admin.sub,
      operation: 'config_change',
      entityType: 'impersonation',
      entityId: tenantId,
      beforeValue: { admin: admin.sub },
      afterValue: { previewCustomer: result.customer.id, as: 'customer' },
    });
    return result;
  }

  /** GET /api/admin/tenants — list tenants (own tenant only for owner). */
  @Get('tenants')
  async listTenants(@CurrentUser() user: JWTPayload): Promise<TenantRecord[]> {
    const all = await this.adminService.listTenants();
    if (user.role === Role.PlatformSuperAdmin) return all;
    return all.filter((t) => t.id === user.tenant_id);
  }

  /** POST /api/admin/tenants — create tenant (super-admin only). */
  @Post('tenants')
  @Roles(Role.PlatformSuperAdmin)
  async createTenant(@Body() dto: CreateTenantDto): Promise<TenantRecord> {
    return this.adminService.createTenant(dto);
  }

  /** PUT /api/admin/tenants/:id — edit tenant (super-admin only). */
  @Put('tenants/:id')
  @Roles(Role.PlatformSuperAdmin)
  async updateTenant(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantRecord> {
    const tenantId = await this.adminService.resolveTenantId(id);
    // Capture the plan before the edit so a change can be recorded for MRR analytics.
    const before = dto.plan !== undefined ? (await this.adminService.listTenants()).find((t) => t.id === tenantId)?.plan ?? null : null;
    const updated = await this.adminService.updateTenant(tenantId, dto);
    if (dto.plan !== undefined && dto.plan !== before) {
      this.entitlements.invalidate(tenantId);
      await this.lifecycle.recordPlanChange(tenantId, before, updated.plan, admin.sub);
    }
    return updated;
  }

  /** GET /api/admin/tenants/:id/modules — module states (super-admin only). */
  @Get('tenants/:id/modules')
  @Roles(Role.PlatformSuperAdmin)
  async getTenantModules(@Param('id') id: string): Promise<Record<string, boolean>> {
    return this.adminService.getTenantModules(await this.adminService.resolveTenantId(id));
  }

  /** PUT /api/admin/tenants/:id/modules — toggle modules (super-admin only, audited). */
  @Put('tenants/:id/modules')
  @Roles(Role.PlatformSuperAdmin)
  async setTenantModules(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: { modules: Record<string, boolean> },
  ): Promise<Record<string, boolean>> {
    const tenantId = await this.adminService.resolveTenantId(id);
    const before = await this.adminService.getTenantModules(tenantId);
    const after = await this.adminService.setTenantModules(tenantId, body?.modules ?? {});
    await this.audit.log({
      tenantId,
      userId: admin.sub,
      operation: 'config_change',
      entityType: 'tenant_modules',
      entityId: tenantId,
      beforeValue: before,
      afterValue: after,
    });
    return after;
  }

  // ── AI configuration (super-admin owns the whole brain; tenant only sees the
  //    WhatsApp connection + an on/off pause — see agent-config module) ────────

  /**
   * Per-tenant AI-config view: the tenant's PERSONA (base prompt, product
   * knowledge, skills, daily cap) + the AI on/off flag. The LLM connection
   * (provider / API key / model) is PLATFORM-WIDE — see the platform/ai
   * endpoints — so it is NOT part of this per-tenant view.
   */
  private async aiConfigView(tenantId: string) {
    const agent = await this.agentConfig.get(tenantId);
    return {
      basePrompt: agent.basePrompt,
      productKnowledge: agent.productKnowledge,
      skills: agent.skills,
      maxMessagesPerDay: agent.maxMessagesPerDay,
      aiEnabled: agent.aiEnabled,
    };
  }

  /** GET /api/admin/tenants/:id/ai-config — per-tenant persona + AI on/off (super-admin only). */
  @Get('tenants/:id/ai-config')
  @Roles(Role.PlatformSuperAdmin)
  async getTenantAiConfig(@Param('id') id: string) {
    return this.aiConfigView(await this.adminService.resolveTenantId(id));
  }

  /** PUT /api/admin/tenants/:id/ai-config — update per-tenant persona + AI on/off (audited). */
  @Put('tenants/:id/ai-config')
  @Roles(Role.PlatformSuperAdmin)
  async setTenantAiConfig(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: {
      basePrompt?: string | null;
      productKnowledge?: string | null;
      skills?: string | null;
      maxMessagesPerDay?: number;
      aiEnabled?: boolean;
    } = {},
  ) {
    const tenantId = await this.adminService.resolveTenantId(id);
    const before = await this.aiConfigView(tenantId);

    await this.agentConfig.adminUpdateBrain(tenantId, {
      basePrompt: body.basePrompt,
      productKnowledge: body.productKnowledge,
      skills: body.skills,
      maxMessagesPerDay: body.maxMessagesPerDay,
    });

    if (body.aiEnabled !== undefined) {
      await this.settings.updateSettings(tenantId, admin.sub, { ai_enabled: body.aiEnabled });
    }

    const after = await this.aiConfigView(tenantId);
    await this.audit.log({
      tenantId,
      userId: admin.sub,
      operation: 'config_change',
      entityType: 'tenant_ai_config',
      entityId: tenantId,
      beforeValue: before,
      afterValue: after,
    });
    return after;
  }

  // ── Platform-wide LLM connection (ONE key/provider/model for ALL tenants) ────

  /** GET /api/admin/platform/ai — platform LLM connection (super-admin only; no raw key). */
  @Get('platform/ai')
  @Roles(Role.PlatformSuperAdmin)
  async getPlatformAi() {
    return this.settings.getPlatformLlmPublic();
  }

  /** PUT /api/admin/platform/ai — set the platform LLM connection (super-admin only). */
  @Put('platform/ai')
  @Roles(Role.PlatformSuperAdmin)
  async setPlatformAi(
    @Body() body: { provider?: 'openrouter' | 'hermes_ai'; model?: string | null; apiKey?: string } = {},
  ) {
    await this.settings.setPlatformLlm({ provider: body.provider, model: body.model, apiKey: body.apiKey });
    return this.settings.getPlatformLlmPublic();
  }

  /** GET /api/admin/platform/ai/key — reveal the decrypted platform API key (super-admin only). */
  @Get('platform/ai/key')
  @Roles(Role.PlatformSuperAdmin)
  async revealPlatformAiKey(@CurrentUser() admin: JWTPayload) {
    const platform = await this.settings.getPlatformLlm();
    this.logger.warn(`Platform LLM API key revealed by user ${admin.sub}`);
    return { apiKey: platform.apiKey ?? null };
  }

  /** PATCH /api/admin/tenants/:id/suspend — suspend tenant (super-admin only). */
  @Patch('tenants/:id/suspend')
  @Roles(Role.PlatformSuperAdmin)
  async suspendTenant(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ): Promise<TenantRecord> {
    const tenantId = await this.adminService.resolveTenantId(id);
    return this.lifecycle.suspend(tenantId, { reason: body?.reason, actorUserId: admin.sub, source: 'admin' });
  }

  /** PATCH /api/admin/tenants/:id/reactivate — reactivate tenant (super-admin only). */
  @Patch('tenants/:id/reactivate')
  @Roles(Role.PlatformSuperAdmin)
  async reactivateTenant(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ): Promise<TenantRecord> {
    const tenantId = await this.adminService.resolveTenantId(id);
    return this.lifecycle.reactivate(tenantId, { reason: body?.reason, actorUserId: admin.sub, source: 'admin' });
  }

  /** PATCH /api/admin/tenants/:id/cancel — cancel tenant (super-admin only). */
  @Patch('tenants/:id/cancel')
  @Roles(Role.PlatformSuperAdmin)
  async cancelTenant(
    @CurrentUser() admin: JWTPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ): Promise<TenantRecord> {
    const tenantId = await this.adminService.resolveTenantId(id);
    return this.lifecycle.cancel(tenantId, { reason: body?.reason, actorUserId: admin.sub, source: 'admin' });
  }

  /** GET /api/admin/tenants/:id/status-events — status-change history (super-admin only). */
  @Get('tenants/:id/status-events')
  @Roles(Role.PlatformSuperAdmin)
  async tenantStatusEvents(@Param('id') id: string) {
    return this.lifecycle.history(await this.adminService.resolveTenantId(id));
  }

  /**
   * GET /api/admin/tenants/:id/entitlements — plan limits vs live usage. Available
   * to a tenant owner for their OWN tenant (self-serve usage view) and to the
   * super-admin for any tenant.
   */
  @Get('tenants/:id/entitlements')
  async tenantEntitlements(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.entitlements.snapshot((await this.effTenantIdResolved(user, id))!);
  }

  /** GET /api/admin/config — platform configuration (read; owners see it read-only). */
  @Get('config')
  async getPlatformConfig(): Promise<PlatformConfig> {
    return this.adminService.getPlatformConfig();
  }

  /** PUT /api/admin/config — update platform configuration (super-admin only). */
  @Put('config')
  @Roles(Role.PlatformSuperAdmin)
  async updatePlatformConfig(
    @Body() config: Partial<PlatformConfig>,
  ): Promise<PlatformConfig> {
    return this.adminService.updatePlatformConfig(config);
  }

  // ── SaaS subscription plans (what the platform charges tenants) ──────────────

  /** GET /api/admin/platform-plans — list subscription plans. */
  @Get('platform-plans')
  async listPlatformPlans() {
    return this.plans.list();
  }

  /** POST /api/admin/platform-plans — create a plan (super-admin only). */
  @Post('platform-plans')
  @Roles(Role.PlatformSuperAdmin)
  async createPlatformPlan(@Body() dto: CreatePlatformPlanDto) {
    return this.plans.create(dto);
  }

  /** PUT /api/admin/platform-plans/:id — update a plan (super-admin only). */
  @Put('platform-plans/:id')
  @Roles(Role.PlatformSuperAdmin)
  async updatePlatformPlan(@Param('id') id: string, @Body() dto: UpdatePlatformPlanDto) {
    return this.plans.update(id, dto);
  }

  /** DELETE /api/admin/platform-plans/:id — deactivate a plan (super-admin only). */
  @Delete('platform-plans/:id')
  @Roles(Role.PlatformSuperAdmin)
  async deletePlatformPlan(@Param('id') id: string) {
    await this.plans.remove(id);
    return { ok: true };
  }

  // ── Audit log (platform-wide viewer, super-admin only) ───────────────────────

  /** GET /api/admin/audit — cross-tenant audit log with filters + pagination. */
  @Get('audit')
  @Roles(Role.PlatformSuperAdmin)
  async auditLog(
    @Query('tenantId') tenantId?: string,
    @Query('operation') operation?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.metrics.getAuditLog({
      tenantId, operation, entityType, dateFrom, dateTo,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 50,
    });
  }

  /** GET /api/admin/audit/filters — distinct operations + entity types. */
  @Get('audit/filters')
  @Roles(Role.PlatformSuperAdmin)
  async auditFilters() {
    return this.metrics.getAuditFilters();
  }

  // ── Growth analytics (super-admin only) ─────────────────────────────────────

  /** GET /api/admin/analytics?months= — SaaS growth metrics. */
  @Get('analytics')
  @Roles(Role.PlatformSuperAdmin)
  async analytics(@Query('months') months?: string) {
    return this.metrics.getGrowthAnalytics(months ? parseInt(months, 10) : 12);
  }

  // ── Ops & alert feed (super-admin only) ──────────────────────────────────────

  /** GET /api/admin/ops-feed — cross-tenant activity/alert stream from domain_events. */
  @Get('ops-feed')
  @Roles(Role.PlatformSuperAdmin)
  async opsFeed(
    @Query('severity') severity?: OpsSeverity,
    @Query('tenantId') tenantId?: string,
    @Query('types') types?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ops.feed({
      severity,
      tenantId,
      types: types ? types.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 50,
    });
  }

  /** GET /api/admin/alerts-summary — severity counts (24h/7d) for the overview widget. */
  @Get('alerts-summary')
  @Roles(Role.PlatformSuperAdmin)
  async alertsSummary() {
    return this.ops.alertsSummary();
  }

  // ── Background-job monitor (super-admin only) ────────────────────────────────

  /** GET /api/admin/jobs — heartbeat status of scheduled background jobs. */
  @Get('jobs')
  @Roles(Role.PlatformSuperAdmin)
  async jobsStatus() {
    return this.jobs.list();
  }

  // ── Platform tax profile / Faktur Pajak (super-admin only) ───────────────────

  /** GET /api/admin/platform-tax — Airin's PPN tax profile. */
  @Get('platform-tax')
  @Roles(Role.PlatformSuperAdmin)
  async getPlatformTax() {
    return this.tax.getConfig();
  }

  /** PUT /api/admin/platform-tax — update the platform tax profile (audited). */
  @Put('platform-tax')
  @Roles(Role.PlatformSuperAdmin)
  async setPlatformTax(@CurrentUser() admin: JWTPayload, @Body() body: Partial<PlatformTaxConfig>) {
    const next = await this.tax.setConfig(body ?? {});
    await this.audit.log({
      tenantId: admin.tenant_id ?? admin.sub, userId: admin.sub,
      operation: 'config_change', entityType: 'platform_tax', entityId: 'default',
      afterValue: { enabled: next.enabled, rate: next.rate },
    });
    return next;
  }

  /** POST /api/admin/invoices/:id/faktur — set the official DJP Faktur Pajak serial. */
  @Post('invoices/:id/faktur')
  @Roles(Role.PlatformSuperAdmin)
  async setInvoiceFaktur(@Param('id') id: string, @Body() body: { fakturNumber: string }) {
    if (!body?.fakturNumber?.trim()) throw new BadRequestException('fakturNumber is required');
    await this.tax.setFakturNumber(id, body.fakturNumber);
    return { ok: true, fakturNumber: body.fakturNumber.trim() };
  }

  // ── Platform invoices (super-admin only) ─────────────────────────────────────

  /** GET /api/admin/invoices?status=&tenantId=&period= — list invoices. */
  @Get('invoices')
  @Roles(Role.PlatformSuperAdmin)
  async listInvoices(
    @Query('status') status?: InvoiceStatus,
    @Query('tenantId') tenantId?: string,
    @Query('period') period?: string,
  ) {
    return this.invoices.list({ status, tenantId, period });
  }

  /** GET /api/admin/invoices/summary — outstanding / overdue / paid rollup. */
  @Get('invoices/summary')
  @Roles(Role.PlatformSuperAdmin)
  async invoiceSummary() {
    return this.invoices.summary();
  }

  /** POST /api/admin/invoices/generate — create drafts for a period (idempotent). */
  @Post('invoices/generate')
  @Roles(Role.PlatformSuperAdmin)
  async generateInvoices(@Body() body: { period: string }) {
    return this.invoices.generate(body?.period);
  }

  /** PATCH /api/admin/invoices/:id/status — advance an invoice's lifecycle. */
  @Patch('invoices/:id/status')
  @Roles(Role.PlatformSuperAdmin)
  async setInvoiceStatus(@Param('id') id: string, @Body() body: { status: InvoiceStatus }) {
    return this.invoices.updateStatus(id, body?.status);
  }

  /** PUT /api/admin/invoices/:id — edit amount / due date / notes. */
  @Put('invoices/:id')
  @Roles(Role.PlatformSuperAdmin)
  async updateInvoice(@Param('id') id: string, @Body() dto: { amount?: number; dueDate?: string | null; notes?: string | null }) {
    return this.invoices.update(id, dto);
  }

  // ── Platform users (super-admin only) ────────────────────────────────────────

  /** GET /api/admin/platform-users — list platform admins. */
  @Get('platform-users')
  @Roles(Role.PlatformSuperAdmin)
  async listPlatformUsers() {
    return this.platformUsers.listAdmins();
  }

  /** POST /api/admin/platform-users — create a platform admin (audited). */
  @Post('platform-users')
  @Roles(Role.PlatformSuperAdmin)
  async createPlatformUser(@CurrentUser() admin: JWTPayload, @Body() dto: CreatePlatformUserDto) {
    const created = await this.platformUsers.createAdmin(dto);
    await this.audit.log({
      tenantId: admin.tenant_id ?? created.id, userId: admin.sub,
      operation: 'role_change', entityType: 'platform_user', entityId: created.id,
      afterValue: { email: created.email, role: created.role },
    });
    return created;
  }

  /** PATCH /api/admin/platform-users/:id/active — enable/disable (cannot disable self). */
  @Patch('platform-users/:id/active')
  @Roles(Role.PlatformSuperAdmin)
  async setPlatformUserActive(@CurrentUser() admin: JWTPayload, @Param('id') id: string, @Body() body: { isActive: boolean }) {
    if (id === admin.sub && body?.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    return this.platformUsers.setActive(id, body?.isActive);
  }

  /** POST /api/admin/platform-users/:id/password — set a platform admin's password (audited). */
  @Post('platform-users/:id/password')
  @Roles(Role.PlatformSuperAdmin)
  async setPlatformUserPassword(@CurrentUser() admin: JWTPayload, @Param('id') id: string, @Body() body: { password: string }) {
    const res = await this.platformUsers.setAdminPassword(id, body?.password);
    await this.audit.log({
      tenantId: admin.tenant_id ?? id, userId: admin.sub,
      operation: 'config_change', entityType: 'platform_user_password', entityId: id,
    });
    return res;
  }

  /** POST /api/admin/tenants/:id/reset-owner-password — reset a tenant owner's password (audited). */
  @Post('tenants/:id/reset-owner-password')
  @Roles(Role.PlatformSuperAdmin)
  async resetTenantOwnerPassword(@CurrentUser() admin: JWTPayload, @Param('id') id: string, @Body() body: { password: string }) {
    const tenantId = await this.adminService.resolveTenantId(id);
    const res = await this.platformUsers.resetTenantOwnerPassword(tenantId, body?.password);
    await this.audit.log({
      tenantId, userId: admin.sub,
      operation: 'config_change', entityType: 'tenant_owner_password', entityId: tenantId,
      afterValue: { email: res.email },
    });
    return res;
  }

  // ── Announcements & support notes (super-admin only) ─────────────────────────

  /** GET /api/admin/announcements — list all announcements. */
  @Get('announcements')
  @Roles(Role.PlatformSuperAdmin)
  async listAnnouncements() {
    return this.announcements.list();
  }

  /** POST /api/admin/announcements — create an announcement. */
  @Post('announcements')
  @Roles(Role.PlatformSuperAdmin)
  async createAnnouncement(@CurrentUser() admin: JWTPayload, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(dto, admin.sub);
  }

  /** PUT /api/admin/announcements/:id — edit an announcement. */
  @Put('announcements/:id')
  @Roles(Role.PlatformSuperAdmin)
  async updateAnnouncement(@Param('id') id: string, @Body() dto: Partial<CreateAnnouncementDto>) {
    return this.announcements.update(id, dto);
  }

  /** DELETE /api/admin/announcements/:id — delete an announcement. */
  @Delete('announcements/:id')
  @Roles(Role.PlatformSuperAdmin)
  async deleteAnnouncement(@Param('id') id: string) {
    await this.announcements.remove(id);
    return { ok: true };
  }

  /** GET /api/admin/tenants/:id/notes — internal support notes for a tenant. */
  @Get('tenants/:id/notes')
  @Roles(Role.PlatformSuperAdmin)
  async listTenantNotes(@Param('id') id: string) {
    return this.announcements.listNotes(await this.adminService.resolveTenantId(id));
  }

  /** POST /api/admin/tenants/:id/notes — add an internal support note. */
  @Post('tenants/:id/notes')
  @Roles(Role.PlatformSuperAdmin)
  async addTenantNote(@CurrentUser() admin: JWTPayload, @Param('id') id: string, @Body() body: { body: string; pinned?: boolean }) {
    const tenantId = await this.adminService.resolveTenantId(id);
    return this.announcements.addNote(tenantId, body?.body, admin.sub, body?.pinned ?? false);
  }

  /** DELETE /api/admin/notes/:id — delete a support note. */
  @Delete('notes/:id')
  @Roles(Role.PlatformSuperAdmin)
  async deleteTenantNote(@Param('id') id: string) {
    await this.announcements.removeNote(id);
    return { ok: true };
  }
}
