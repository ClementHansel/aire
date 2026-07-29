import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto, UpdateCampaignDto } from './campaign.interfaces';

/**
 * Owner-facing CRUD for bonus-voucher campaigns — triggered by either a
 * membership plan purchase or a voucher-pack purchase (AIRIN-102). Grant
 * issuance itself happens out-of-band in CampaignGrantService.
 */
@Controller('api/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class CampaignController {
  constructor(private readonly service: CampaignService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) {
    return this.service.list(user.tenant_id);
  }

  @Get(':id')
  get(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.get(user.tenant_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateCampaignDto) {
    return this.service.create(user.tenant_id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deactivate(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.deactivate(user.tenant_id, id);
  }
}
