import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles, RequirePermission } from '../../common/decorators';
import { RolesGuard, PermissionsGuard } from '../../common/guards';
import { CatalogService, AppliesTo } from './catalog.service';

@Controller('api/categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CategoryController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) {
    return this.service.listCategories(user.tenant_id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { name: string; sortOrder?: number; appliesTo?: AppliesTo }) {
    return this.service.createCategory(user.tenant_id, dto.name, dto.sortOrder, dto.appliesTo);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; sortOrder?: number; isActive?: boolean; appliesTo?: AppliesTo }) {
    return this.service.updateCategory(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.removeCategory(user.tenant_id, id);
  }
}

@Controller('api/brands')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BrandController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) {
    return this.service.listBrands(user.tenant_id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { code: string; name: string; color?: string; appliesTo?: AppliesTo }) {
    return this.service.createBrand(user.tenant_id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; color?: string; isActive?: boolean; appliesTo?: AppliesTo }) {
    return this.service.updateBrand(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.removeBrand(user.tenant_id, id);
  }
}
