import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { LegalEntityService, UpsertLegalEntityDto } from './legal-entity.service';

/**
 * Legal-entity (PT) catalog, scoped to the caller's tenant. Reads are allowed
 * for any authenticated user (the branch editor needs the list); writes are
 * restricted to the tenant owner, mirroring outlet management.
 */
@Controller('api/legal-entities')
@UseGuards(JwtAuthGuard)
export class LegalEntityController {
  constructor(private readonly service: LegalEntityService) {}

  @Get()
  async findAll(@CurrentUser() user: JWTPayload, @Query('active') active?: string) {
    return this.service.findAll(user.tenant_id, active === 'true');
  }

  @Get(':id')
  async findById(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.findById(user.tenant_id, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JWTPayload, @Body() dto: UpsertLegalEntityDto) {
    return this.service.create(user.tenant_id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  async update(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() dto: Partial<UpsertLegalEntityDto>,
  ) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.TenantOwner)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.remove(user.tenant_id, id);
  }
}
