import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles, RequirePermission } from '../../common/decorators';
import { RolesGuard, PermissionsGuard } from '../../common/guards';
import { BusinessUnitService } from './business-unit.service';

/**
 * Business unit CRUD (AIRIN-176). Reading is open to any signed-in user — the
 * POS tabs, report filters and service form all need the list — while writing
 * is owner-level, matching how the rest of the catalog is gated.
 */
@Controller('api/business-units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BusinessUnitController {
  constructor(private readonly service: BusinessUnitService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload, @Query('activeOnly') activeOnly?: string) {
    return this.service.list(user.tenant_id, activeOnly !== 'true');
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JWTPayload,
    @Body() dto: { code: string; name: string; color?: string; sortOrder?: number },
  ) {
    return this.service.create(user.tenant_id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  update(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() dto: { name?: string; color?: string; sortOrder?: number; isActive?: boolean },
  ) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.remove(user.tenant_id, id);
  }
}
