import { Controller, Get, Post, Patch, Body, Param, Query, Headers, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { PosDeviceService } from './pos-device.service';

/**
 * Admin management of POS terminals — provision/deactivate the device tokens
 * that authorize a registered POS. Outlet Admin and above.
 */
@Controller('api/pos-devices')
export class PosDeviceController {
  constructor(private readonly service: PosDeviceService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OutletAdmin)
  list(@CurrentUser() user: JWTPayload) {
    return this.service.list(user.tenant_id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OutletAdmin)
  create(@CurrentUser() user: JWTPayload, @Body() body: { outletId: string; label?: string }) {
    return this.service.create(user.tenant_id, body.outletId, body.label);
  }

  @Patch(':id/active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OutletAdmin)
  setActive(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.service.setActive(user.tenant_id, id, body.isActive);
  }

  /**
   * Public: a POS terminal validates its launch token (no login yet) to pin the
   * branch. Token via `x-pos-token` header or `posToken` query param.
   */
  @Get('validate')
  validate(@Headers('x-pos-token') header?: string, @Query('posToken') query?: string) {
    return this.service.validate(header || query || '');
  }
}
