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
import { Roles, CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../../common/guards';
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
@Controller('api/customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * GET /api/customers/list — paginated CRM customer list (tenant-scoped).
   */
  @Get('list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OutletAdmin)
  async list(
    @CurrentUser() user: JWTPayload,
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('outletId') outletId?: string,
  ) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.customerService.listCustomers(
      user.tenant_id,
      pageStr ? parseInt(pageStr, 10) : 1,
      pageSizeStr ? parseInt(pageSizeStr, 10) : 50,
      search,
      ids,
    );
  }

  /**
   * PUT /api/customers/:id — edit a customer (CRM).
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OutletAdmin)
  async update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { name?: string; phone?: string }) {
    return this.customerService.updateCustomer(user.tenant_id, id, body);
  }

  /**
   * DELETE /api/customers/:id — remove a customer (CRM).
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TenantOwner)
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
  @Roles(Role.PlatformSuperAdmin, Role.TenantOwner, Role.OutletAdmin)
  async searchCustomers(
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

    return this.customerService.searchCustomers(search.trim(), page, pageSize);
  }

  /**
   * GET /api/customers/:id/profile
   * Get full customer profile with visit history, membership status, and preferences.
   * Accessible by Tenant_Owner and Outlet_Admin.
   */
  @Get(':id/profile')
  @Roles(Role.PlatformSuperAdmin, Role.TenantOwner, Role.OutletAdmin)
  async getProfile(@Param('id') id: string) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Customer ID is required');
    }
    return this.customerService.getProfile(id);
  }

  /**
   * GET /api/customers/:id/analytics
   * Get customer analytics: visit frequency, spending patterns, segmentation.
   * Accessible by Tenant_Owner and Outlet_Admin.
   */
  @Get(':id/analytics')
  @Roles(Role.PlatformSuperAdmin, Role.TenantOwner, Role.OutletAdmin)
  async getAnalytics(@Param('id') id: string) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Customer ID is required');
    }
    return this.customerService.getAnalytics(id);
  }
}
