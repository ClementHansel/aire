import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@aire/shared';
import { Roles } from '../../common/decorators';
import { CustomerService } from './customer.service';

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
  constructor(private readonly customerService: CustomerService) {}

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
