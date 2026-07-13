import { Controller, Get, Put, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { RecipeService, SetRecipeDto } from './recipe.service';

/**
 * Recipe / BOM, cost-component types, and UOM conversions. Outlet Admin and above.
 */
@Controller('api')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipeController {
  constructor(private readonly service: RecipeService) {}

  @Get('services/:id/recipe')
  @Roles(Role.OutletAdmin)
  getRecipe(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getRecipe(user.tenant_id, id);
  }

  @Put('services/:id/recipe')
  @Roles(Role.OutletAdmin)
  async setRecipe(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: SetRecipeDto) {
    await this.service.setRecipe(user.tenant_id, id, dto);
    return { ok: true };
  }

  @Get('cost-component-types')
  @Roles(Role.OutletAdmin)
  listCostTypes(@CurrentUser() user: JWTPayload) {
    return this.service.listCostTypes(user.tenant_id);
  }

  @Post('cost-component-types')
  @Roles(Role.OutletAdmin)
  createCostType(@CurrentUser() user: JWTPayload, @Body() body: { name: string; kind: 'fixed' | 'percentage' }) {
    return this.service.createCostType(user.tenant_id, body.name, body.kind);
  }

  @Delete('cost-component-types/:id')
  @Roles(Role.OutletAdmin)
  async deleteCostType(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.deleteCostType(user.tenant_id, id);
    return { ok: true };
  }

  @Get('inventory/:id/uom')
  @Roles(Role.OutletAdmin)
  listUom(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.listUom(user.tenant_id, id);
  }

  @Post('inventory/:id/uom')
  @Roles(Role.OutletAdmin)
  createUom(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { fromUnit: string; toUnit: string; factor: number }) {
    return this.service.createUom(user.tenant_id, id, body.fromUnit, body.toUnit, body.factor);
  }

  @Delete('uom/:id')
  @Roles(Role.OutletAdmin)
  async deleteUom(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.deleteUom(user.tenant_id, id);
    return { ok: true };
  }
}
