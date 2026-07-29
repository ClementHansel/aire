import { Controller, Get, Patch, Put, Param, Query, Body, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { ScopeService } from '../../common/scope/scope.service';
import { MembershipAdminService } from './membership-admin.service';

/**
 * Membership management for the CRM / POS.
 *  - List, plate management (add/edit/remove), and cancel are available to
 *    any authenticated staff — a cashier needs these day-to-day.
 *  - Suspend / reactivate require a higher-level role (Outlet Admin or above).
 */
@Controller('api/memberships')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MembershipAdminController {
  constructor(
    private readonly service: MembershipAdminService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * GET /api/memberships/manage?status=&dateFrom=&dateTo=&outletId=
   * dateFrom/dateTo/outletId are optional (AIRIN-133) — the CRM members
   * list (MembersPanel) calls this with none of them and still expects the
   * full tenant list. When provided, dateFrom/dateTo filter by the linked
   * fee order's purchase date and outletId narrows via ScopeService, same
   * pattern as ReportController/OrderController.
   */
  @Get('manage')
  async list(
    @CurrentUser() user: JWTPayload,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
  ) {
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      throw new BadRequestException('Invalid dateFrom format. Use ISO date string.');
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      throw new BadRequestException('Invalid dateTo format. Use ISO date string.');
    }
    // Branch scoping applies ONLY when the caller explicitly asks for a branch.
    // A membership is tenant-scoped by design — a member who signs up at one
    // branch washes at any of them — and this list is the day-to-day member
    // management surface for every staff role (see the class doc). Resolving the
    // caller's branches unconditionally would filter by the *purchase* order's
    // branch, so a cashier could no longer manage a member who signed up
    // elsewhere, and memberships with no linked fee order would vanish entirely.
    // Passing outletId still goes through ScopeService, so an outlet-bound user
    // cannot narrow to a branch they are not assigned to.
    const outletIds = outletId ? await this.scope.resolveOutletIds(user, outletId) : undefined;
    return this.service.list(user.tenant_id, status, { dateFrom, dateTo, outletIds });
  }

  @Get(':id/events')
  events(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.history(user.tenant_id, id);
  }

  /**
   * PUT /api/memberships/:id/plates — full-replace the membership's
   * registered plates (POS plate CRUD: add / edit / remove in one save).
   */
  @Put(':id/plates')
  @HttpCode(HttpStatus.OK)
  async updatePlates(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { plates: { plate: string; brand?: string; model?: string }[] },
  ) {
    if (!Array.isArray(body?.plates)) {
      throw new BadRequestException('plates must be an array');
    }
    return this.service.updatePlates(user.tenant_id, id, body.plates, user.sub);
  }

  /**
   * PATCH /api/memberships/:id/cancel — cancel a membership (POS "Cancel
   * membership" action). Releases its plates; audit-logged + event-emitted.
   */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { reason?: string }) {
    await this.service.cancel(user.tenant_id, id, body?.reason, user.sub);
    return { ok: true };
  }

  @Patch(':id/suspend')
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.OK)
  async suspend(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { reason?: string }) {
    await this.service.suspend(user.tenant_id, id, body?.reason, user.sub);
    return { ok: true };
  }

  @Patch(':id/reactivate')
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.OK)
  async reactivate(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.reactivate(user.tenant_id, id, user.sub);
    return { ok: true };
  }
}
