import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { JWTPayload, CreateServiceRequest, ServiceDTO, ServiceCategory, BusinessUnit } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ServiceService } from '../service/service.service';

/**
 * Product catalog controller — a dedicated API for sellable retail products.
 *
 * Products and services share one underlying store (a product is a service row
 * with category = 'product'), so products created here appear on the POS menu
 * exactly like services. This controller keeps the API surface separate
 * (`/api/products` vs `/api/services`) and pins the category to 'product' so a
 * product can never be miscategorised.
 *
 * Endpoints:
 *   POST   /api/products     — create product
 *   GET    /api/products     — list products (outletId, active filters)
 *   GET    /api/products/:id — get single product
 *   PUT    /api/products/:id — update product
 *   DELETE /api/products/:id — soft delete (set is_active = false)
 *
 * The recipe/stock sub-resource stays on `/api/services/:id/recipe` since it is
 * keyed by the shared row id and used identically for both.
 */
@Controller('api/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductController {
  constructor(private readonly serviceService: ServiceService) {}

  @Post()
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateServiceRequest,
  ): Promise<ServiceDTO> {
    return this.serviceService.create(user.tenant_id, { ...dto, category: ServiceCategory.Product });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser() user: JWTPayload,
    @Query('businessUnit') businessUnit?: string,
    @Query('outletId') outletId?: string,
    @Query('active') active?: string,
  ): Promise<ServiceDTO[]> {
    return this.serviceService.findAll({
      tenantId: user.tenant_id,
      category: ServiceCategory.Product,
      businessUnit: businessUnit as BusinessUnit | undefined,
      outletId: outletId ?? undefined,
      active: active !== undefined ? active === 'true' : undefined,
    });
  }

  /**
   * Resolve a product/service by its barcode (POS scan-to-cart). Two-segment
   * path so it never collides with `:id`. Optional ?outletId scopes to a branch.
   */
  @Get('by-barcode/:code')
  @HttpCode(HttpStatus.OK)
  async findByBarcode(
    @CurrentUser() user: JWTPayload,
    @Param('code') code: string,
    @Query('outletId') outletId?: string,
  ): Promise<ServiceDTO> {
    const product = await this.serviceService.findByBarcode(user.tenant_id, code, outletId ?? undefined);
    if (!product) {
      throw new NotFoundException(`No product with barcode ${code}`);
    }
    return product;
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@CurrentUser() user: JWTPayload, @Param('id') id: string): Promise<ServiceDTO> {
    return this.serviceService.findOne(user.tenant_id, id);
  }

  @Put(':id')
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() dto: Partial<CreateServiceRequest>,
  ): Promise<ServiceDTO> {
    // Keep the category pinned to 'product' even if a client omits or changes it.
    return this.serviceService.update(user.tenant_id, id, { ...dto, category: ServiceCategory.Product });
  }

  @Delete(':id')
  @RequirePermission('products.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string): Promise<void> {
    await this.serviceService.remove(user.tenant_id, id);
  }
}
