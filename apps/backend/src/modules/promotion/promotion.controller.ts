import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { PromotionService, UpsertPromotionDto } from './promotion.service';

@Controller('api/promotions')
@UseGuards(JwtAuthGuard)
export class PromotionController {
  constructor(private readonly service: PromotionService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload) { return this.service.list(user.tenant_id); }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: UpsertPromotionDto) {
    return this.service.create(user.tenant_id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: Partial<UpsertPromotionDto>) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OutletAdmin)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    await this.service.remove(user.tenant_id, id);
  }
}
