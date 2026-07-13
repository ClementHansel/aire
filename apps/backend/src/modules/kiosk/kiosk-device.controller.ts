import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { KioskDeviceService } from './kiosk-device.service';

/**
 * Admin management of kiosk devices — provision/deactivate the tokens that
 * authorize the public kiosk. Outlet Admin and above.
 */
@Controller('api/kiosk-devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KioskDeviceController {
  constructor(private readonly service: KioskDeviceService) {}

  @Get()
  @Roles(Role.OutletAdmin)
  list(@CurrentUser() user: JWTPayload) {
    return this.service.list(user.tenant_id);
  }

  @Post()
  @Roles(Role.OutletAdmin)
  create(@CurrentUser() user: JWTPayload, @Body() body: { outletId: string; label?: string }) {
    return this.service.create(user.tenant_id, body.outletId, body.label);
  }

  @Patch(':id/active')
  @Roles(Role.OutletAdmin)
  setActive(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.service.setActive(user.tenant_id, id, body.isActive);
  }
}
