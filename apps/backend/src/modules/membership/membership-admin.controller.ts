import { Controller, Get, Patch, Param, Query, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { MembershipAdminService } from './membership-admin.service';

/**
 * Membership management for the CRM.
 *  - List is available to any authenticated staff.
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
