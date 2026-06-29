import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { Role } from '@aire/shared';
import { OutletService, OutletRecord, CreateOutletDto, UpdateOutletDto } from './outlet.service';

/**
 * OutletController exposes REST endpoints for outlet CRUD operations,
 * including activation/deactivation.
 *
 * Requirement 3.1: Management of all Outlets within the Tenant
 *   including creating, editing, and deactivating Outlets.
 * Requirement 4.2: Platform admin can manage outlets.
 *
 * Tenant_Owner can manage outlets within their tenant.
 * Platform_Super_Admin can manage all outlets.
 */
@Controller('api/outlets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class OutletController {
  constructor(private readonly outletService: OutletService) {}

  /**
   * POST /api/outlets
   * Creates a new outlet.
   * Tenant_Owner creates within their own tenant.
   * Platform_Super_Admin can specify any tenantId.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateOutletDto,
  ): Promise<OutletRecord> {
    // For Tenant_Owner, enforce their own tenant_id
    const tenantId =
      user.role === 'platform_super_admin' ? dto.tenantId : user.tenant_id;

    return this.outletService.create({ ...dto, tenantId });
  }

  /**
   * GET /api/outlets
   * Returns all outlets for the authenticated user's tenant,
   * or all outlets for Platform_Super_Admin.
   * Supports optional ?tenantId= query param for super admin filtering.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser() user: JWTPayload,
    @Query('tenantId') tenantId?: string,
  ): Promise<OutletRecord[]> {
    if (user.role === 'platform_super_admin') {
      return this.outletService.findAll(tenantId);
    }
    // Tenant_Owner sees only their tenant's outlets
    return this.outletService.findAll(user.tenant_id);
  }

  /**
   * GET /api/outlets/:id
   * Returns a single outlet by ID.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<OutletRecord> {
    return this.outletService.findById(id);
  }

  /**
   * PUT /api/outlets/:id
   * Updates an outlet.
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOutletDto,
  ): Promise<OutletRecord> {
    return this.outletService.update(id, dto);
  }

  /**
   * PATCH /api/outlets/:id/activate
   * Activates an outlet.
   */
  @Patch(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@Param('id') id: string): Promise<OutletRecord> {
    return this.outletService.activate(id);
  }

  /**
   * PATCH /api/outlets/:id/deactivate
   * Deactivates an outlet.
   */
  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('id') id: string): Promise<OutletRecord> {
    return this.outletService.deactivate(id);
  }
}
