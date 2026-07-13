import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles, RequirePermission } from '../../common/decorators';
import { RolesGuard, PermissionsGuard } from '../../common/guards';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { AccessService } from './access.service';

/** Permission catalog + the caller's own effective permissions (for the RBAC editor and UI gating). */
@Controller('api/permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionController {
  constructor(
    private readonly service: AccessService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Full catalog — used by the role editor. Outlet-admin+ only. */
  @Get()
  @Roles(Role.OutletAdmin)
  list() { return this.service.getPermissionCatalog(); }

  /** The current user's effective permission keys (['*'] = all). Any signed-in user. */
  @Get('me')
  @Roles(Role.Cashier)
  async mine(@CurrentUser() user: JWTPayload) {
    return { permissions: await this.permissions.getEffectivePermissions(user.sub) };
  }
}

/** Dynamic roles — managing roles requires tenant-owner (higher privilege). */
@Controller('api/roles')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.TenantOwner)
@RequirePermission('roles.write')
export class RoleController {
  constructor(
    private readonly service: AccessService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) { return this.service.listRoles(user.tenant_id); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { name: string; description?: string; baseRole?: string; permissions?: string[] }) {
    return this.service.createRole(user.tenant_id, dto);
  }

  @Put(':id')
  async update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; description?: string; baseRole?: string; permissions?: string[] }) {
    const res = await this.service.updateRole(user.tenant_id, id, dto);
    // A role's permission set changed — drop cached effective permissions so it takes effect at once.
    this.permissions.invalidate();
    return res;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.removeRole(user.tenant_id, id);
    this.permissions.invalidate();
  }
}

/** Users + multi-branch placement — requires tenant-owner. */
@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.TenantOwner)
@RequirePermission('users.write')
export class UserController {
  constructor(
    private readonly service: AccessService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) { return this.service.listUsers(user.tenant_id); }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: { name: string; email: string; password: string; role?: string; customRoleId?: string | null; outletIds?: string[] }) {
    return this.service.createUser(user.tenant_id, dto);
  }

  @Put(':id')
  async update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: { name?: string; role?: string; customRoleId?: string | null; isActive?: boolean; outletIds?: string[]; password?: string }) {
    const res = await this.service.updateUser(user.tenant_id, id, dto);
    // Role/custom-role assignment may have changed — invalidate this user's cached permissions.
    this.permissions.invalidate(id);
    return res;
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.deactivateUser(user.tenant_id, id);
    this.permissions.invalidate(id);
  }
}
