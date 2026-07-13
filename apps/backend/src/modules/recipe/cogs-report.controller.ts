import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles, RequirePermission } from '../../common/decorators';
import { RolesGuard, PermissionsGuard } from '../../common/guards';
import { CogsReportService } from './cogs-report.service';

/** COGS P&L, per-product margin, and inventory variance. Outlet Admin and above, with finance.read. */
@Controller('api/cogs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('finance.read')
export class CogsReportController {
  constructor(private readonly service: CogsReportService) {}

  @Get('pnl')
  @Roles(Role.OutletAdmin)
  pnl(@CurrentUser() user: JWTPayload, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.service.pnl(user.tenant_id, dateFrom, dateTo);
  }

  @Get('product-margin')
  @Roles(Role.OutletAdmin)
  productMargin(@CurrentUser() user: JWTPayload, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.service.productMargin(user.tenant_id, dateFrom, dateTo);
  }

  @Get('inventory-variance')
  @Roles(Role.OutletAdmin)
  inventoryVariance(@CurrentUser() user: JWTPayload, @Query('opnameId') opnameId?: string) {
    return this.service.inventoryVariance(user.tenant_id, opnameId);
  }
}
