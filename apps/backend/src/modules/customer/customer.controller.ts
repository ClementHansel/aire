import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { Roles, CurrentUser, RequirePermission } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard, PermissionsGuard } from '../../common/guards';
import { CustomerService } from './customer.service';
import { ScopeService } from '../../common/scope/scope.service';

/**
 * Customer CRM controller providing profile, analytics, and search endpoints.
 *
 * Endpoints:
 *   GET /api/customers/:id/profile   — Full customer profile
 *   GET /api/customers/:id/analytics — Customer analytics
 *   GET /api/customers?search=       — Search customers
 *
 * Requirements: 34.1, 34.2, 34.3
 */
// Class-level guards ensure NO route is reachable without authentication + a role
// check. Previously the search/profile/analytics routes carried only a @Roles()
// decorator with no guard attached, so the decorator was inert and those endpoints
// were unauthenticated. Per-method @Roles() still sets the minimum role.
@Controller('api/customers')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('customers.read')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * GET /api/customers/list — paginated CRM customer list (tenant-scoped).
   */
  @Get('list')
  @Roles(Role.OutletAdmin)
  async list(
    @CurrentUser() user: JWTPayload,
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('outletId') outletId?: string,
    @Query('segment') segment?: string,
  ) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.customerService.listCustomers(
      user.tenant_id,
      pageStr ? parseInt(pageStr, 10) : 1,
      pageSizeStr ? parseInt(pageSizeStr, 10) : 50,
      search,
      ids,
      segment === 'members' || segment === 'non' ? segment : undefined,
    );
  }

  /**
   * PUT /api/customers/:id — edit a customer (CRM).
   */
  @Put(':id')
  @Roles(Role.OutletAdmin)
  @RequirePermission('customers.write')
  async update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { name?: string; phone?: string }) {
    return this.customerService.updateCustomer(user.tenant_id, id, body);
  }

  /**
   * DELETE /api/customers/:id — remove a customer (CRM).
   */
  @Delete(':id')
  @Roles(Role.TenantOwner)
  @RequirePermission('customers.write')
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.customerService.deleteCustomer(user.tenant_id, id);
    return { ok: true };
  }

  /**
   * GET /api/customers
   * Search customers by name or phone number.
   * Accessible by Tenant_Owner and Outlet_Admin.
   */
  @Get()
  @Roles(Role.OutletAdmin)
  async searchCustomers(
    @CurrentUser() user: JWTPayload,
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
  ) {
    if (!search || search.trim().length === 0) {
      throw new BadRequestException('search query parameter is required');
    }

    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const pageSize = pageSizeStr ? parseInt(pageSizeStr, 10) : 20;

    if (isNaN(page) || page < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (isNaN(pageSize) || pageSize < 1) {
      throw new BadRequestException('pageSize must be a positive integer');
    }

    return this.customerService.searchCustomers(user.tenant_id, search.trim(), page, pageSize);
  }

  /**
   * GET /api/customers/:id/profile
   * Get full customer profile with visit history, membership status, and preferences.
   * Accessible by Tenant_Owner and Outlet_Admin.
   */
  @Get(':id/profile')
  @Roles(Role.OutletAdmin)
  async getProfile(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Customer ID is required');
    }
    return this.customerService.getProfile(user.tenant_id, id);
  }

  /**
   * GET /api/customers/:id/analytics
   * Get customer analytics: visit frequency, spending patterns, segmentation.
   * Accessible by Tenant_Owner and Outlet_Admin.
   */
  @Get(':id/analytics')
  @Roles(Role.OutletAdmin)
  async getAnalytics(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Customer ID is required');
    }
    return this.customerService.getAnalytics(user.tenant_id, id);
  }
}
