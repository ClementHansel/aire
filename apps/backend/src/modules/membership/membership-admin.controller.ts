import { Controller, Get, Patch, Put, Param, Query, Body, UseGuards, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
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
  constructor(private readonly service: MembershipAdminService) {}

  @Get('manage')
  list(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.list(user.tenant_id, status);
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
