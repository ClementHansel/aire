import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { CommissionService, CommissionConfig } from './commission.service';

@Controller('api/commission')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionController {
  constructor(private readonly service: CommissionService) {}

  @Get('config')
  @Roles(Role.OutletAdmin)
  getConfig(@CurrentUser() user: JWTPayload) {
    return this.service.getConfig(user.tenant_id);
  }

  @Put('config')
  @Roles(Role.TenantOwner)
  setConfig(@CurrentUser() user: JWTPayload, @Body() patch: Partial<CommissionConfig>) {
    return this.service.setConfig(user.tenant_id, patch);
  }

  @Get('report')
  @Roles(Role.OutletAdmin)
  report(@CurrentUser() user: JWTPayload, @Query('period') period?: string, @Query('outletId') outletId?: string) {
    return this.service.report(user.tenant_id, { period, outletId });
  }

  @Get('accruals')
  @Roles(Role.OutletAdmin)
  accruals(@CurrentUser() user: JWTPayload, @Query('period') period?: string, @Query('employeeId') employeeId?: string) {
    return this.service.listAccruals(user.tenant_id, { period, employeeId });
  }
}
