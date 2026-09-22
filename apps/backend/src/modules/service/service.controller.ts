import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload, CreateServiceRequest, ServiceDTO, ServiceCategory, BusinessUnit } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ServiceService, ReorderItem } from './service.service';

/**
 * Service catalog management controller.
 * All endpoints are scoped to the authenticated user's tenant via JWT.
 *
 * Endpoints:
 *   POST   /api/services        — create service
 *   GET    /api/services        — list with filters (category, outletId, active)
 *   GET    /api/services/:id    — get single service
 *   PUT    /api/services/:id    — update service
 *   DELETE /api/services/:id    — soft delete (set is_active = false)
 *   PATCH  /api/services/reorder — batch update sort_order
 *
 * Requirements: 30.1, 30.2, 30.3, 30.4, 3.2
 */
@Controller('api/services')
@UseGuards(JwtAuthGuard)
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  /**
   * POST /api/services
   * Creates a new service within the tenant.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateServiceRequest,
  ): Promise<ServiceDTO> {
    return this.serviceService.create(user.tenant_id, dto);
  }

  /**
   * GET /api/services?category=&outletId=&active=
   * Lists services with optional filters.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser() user: JWTPayload,
    @Query('category') category?: string,
    @Query('businessUnit') businessUnit?: string,
    @Query('outletId') outletId?: string,
    @Query('active') active?: string,
    @Query('includeProducts') includeProducts?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ServiceDTO[]> {
    // Retail products have their own API (/api/products). This endpoint returns
    // services only unless a caller explicitly opts in with includeProducts=true.
    return this.serviceService.findAll({
      tenantId: user.tenant_id,
      category: category as ServiceCategory | undefined,
      businessUnit: businessUnit as BusinessUnit | undefined,
      outletId: outletId ?? undefined,
      active: active !== undefined ? active === 'true' : undefined,
      excludeProducts: includeProducts !== 'true',
      includeArchived: includeArchived === 'true',
    });
  }

  /**
   * PATCH /api/services/reorder
   * Batch update sort_order for services within a category.
   * Must be defined before :id routes to avoid route conflicts.
   */
  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(
    @CurrentUser() user: JWTPayload,
    @Body() items: ReorderItem[],
  ): Promise<void> {
    await this.serviceService.reorder(user.tenant_id, items);
  }

  /**
   * GET /api/services/:id
   * Gets a single service by ID.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<ServiceDTO> {
    return this.serviceService.findOne(user.tenant_id, id);
  }

  /**
   * PUT /api/services/:id
   * Updates an existing service.
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() dto: Partial<CreateServiceRequest>,
  ): Promise<ServiceDTO> {
    return this.serviceService.update(user.tenant_id, id, dto);
  }

  /**
   * POST /api/services/:id/restore
   * Puts an archived service back in the catalog (inactive), for a mis-clicked
   * delete. Archiving is invisible by design, so this is the only way back.
   */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<ServiceDTO> {
    return this.serviceService.restore(user.tenant_id, id);
  }

  /**
   * DELETE /api/services/:id
   * Removes a service from the catalog. Physically deleted when it was never
   * sold; otherwise archived (`deleted_at`), which hides it everywhere while
   * the order lines that reference it keep resolving. Either way it is gone
   * from the tenant's catalog — see ServiceService.remove.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean; archived: boolean; orderLines: number }> {
    return this.serviceService.remove(user.tenant_id, id);
  }
}
