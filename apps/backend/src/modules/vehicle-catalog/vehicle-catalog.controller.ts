import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { VehicleCatalogService } from './vehicle-catalog.service';

/** Vehicle brand/type catalog. List is open to any staff (POS needs it); edits are OutletAdmin+. */
@Controller('api')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehicleCatalogController {
  constructor(private readonly service: VehicleCatalogService) {}

  @Get('vehicle-brands')
  list(@CurrentUser() user: JWTPayload) {
    return this.service.listBrandsWithTypes(user.tenant_id);
  }

  @Post('vehicle-brands')
  @Roles(Role.OutletAdmin)
  createBrand(@CurrentUser() user: JWTPayload, @Body() body: { name: string }) {
    return this.service.createBrand(user.tenant_id, body.name);
  }

  @Delete('vehicle-brands/:id')
  @Roles(Role.OutletAdmin)
  async deleteBrand(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.deleteBrand(user.tenant_id, id);
    return { ok: true };
  }

  @Post('vehicle-types')
  @Roles(Role.OutletAdmin)
  createType(@CurrentUser() user: JWTPayload, @Body() body: { brandId: string; name: string }) {
    return this.service.createType(user.tenant_id, body.brandId, body.name);
  }

  @Delete('vehicle-types/:id')
  @Roles(Role.OutletAdmin)
  async deleteType(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.deleteType(user.tenant_id, id);
    return { ok: true };
  }
}
