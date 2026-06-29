import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { Role } from '@aire/shared';
import { TenantService, TenantRecord, CreateTenantDto, UpdateTenantDto } from './tenant.service';

/**
 * TenantController exposes REST endpoints for tenant CRUD operations.
 *
 * Requirement 4.1: Display list of all Tenants with status, plan, creation date.
 * Requirement 4.2: Create, edit, suspend, and reactivate Tenants.
 *
 * All endpoints require Platform_Super_Admin role.
 */
@Controller('api/tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PlatformSuperAdmin)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * POST /api/tenants
   * Creates a new tenant.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTenantDto): Promise<TenantRecord> {
    return this.tenantService.create(dto);
  }

  /**
   * GET /api/tenants
   * Returns all tenants.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(): Promise<TenantRecord[]> {
    return this.tenantService.findAll();
  }

  /**
   * GET /api/tenants/:id
   * Returns a single tenant by ID.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<TenantRecord> {
    return this.tenantService.findById(id);
  }

  /**
   * PUT /api/tenants/:id
   * Updates a tenant by ID.
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantRecord> {
    return this.tenantService.update(id, dto);
  }
}
