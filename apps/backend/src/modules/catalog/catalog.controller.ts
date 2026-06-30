import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CatalogService } from './catalog.service';

@Controller('api/categories')
@UseGuards(JwtAuthGuard)
export class CategoryController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) {
    return this.service.listCategories(user.tenant_id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { name: string; sortOrder?: number }) {
    return this.service.createCategory(user.tenant_id, dto.name, dto.sortOrder);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; sortOrder?: number; isActive?: boolean }) {
    return this.service.updateCategory(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.removeCategory(user.tenant_id, id);
  }
}

@Controller('api/brands')
@UseGuards(JwtAuthGuard)
export class BrandController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) {
    return this.service.listBrands(user.tenant_id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { code: string; name: string; color?: string }) {
    return this.service.createBrand(user.tenant_id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; color?: string; isActive?: boolean }) {
    return this.service.updateBrand(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.removeBrand(user.tenant_id, id);
  }
}
