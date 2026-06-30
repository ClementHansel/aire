import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AccessService } from './access.service';

/** Permission catalog (for the RBAC editor). */
@Controller('api/permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OutletAdmin)
export class PermissionController {
  constructor(private readonly service: AccessService) {}
  @Get()
  list() { return this.service.getPermissionCatalog(); }
}

/** Dynamic roles — managing roles requires tenant-owner (higher privilege). */
@Controller('api/roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class RoleController {
  constructor(private readonly service: AccessService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) { return this.service.listRoles(user.tenant_id); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { name: string; description?: string; baseRole?: string; permissions?: string[] }) {
    return this.service.createRole(user.tenant_id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; description?: string; baseRole?: string; permissions?: string[] }) {
    return this.service.updateRole(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.removeRole(user.tenant_id, id);
  }
}

/** Users + multi-branch placement — requires tenant-owner. */
@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class UserController {
  constructor(private readonly service: AccessService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) { return this.service.listUsers(user.tenant_id); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { name: string; email: string; password: string; role?: string; customRoleId?: string | null; outletIds?: string[] }) {
    return this.service.createUser(user.tenant_id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; role?: string; customRoleId?: string | null; isActive?: boolean; outletIds?: string[]; password?: string }) {
    return this.service.updateUser(user.tenant_id, id, dto);
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.deactivateUser(user.tenant_id, id);
  }
}
