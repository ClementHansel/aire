import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { BarcodeService, BarcodeConfig } from './barcode.service';

/**
 * Barcode feature configuration. Any authenticated user may read the config
 * (POS/label rendering needs it); only the tenant owner may change it.
 */
@Controller('api/barcode')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BarcodeController {
  constructor(private readonly service: BarcodeService) {}

  @Get('config')
  getConfig(@CurrentUser() user: JWTPayload) {
    return this.service.getConfig(user.tenant_id);
  }

  @Put('config')
  @Roles(Role.TenantOwner)
  setConfig(@CurrentUser() user: JWTPayload, @Body() body: Partial<BarcodeConfig>) {
    return this.service.setConfig(user.tenant_id, body ?? {});
  }
}
