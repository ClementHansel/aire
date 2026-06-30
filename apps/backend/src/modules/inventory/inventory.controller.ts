import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { InventoryService, CreateItemDto, AdjustStockDto } from './inventory.service';

@Controller('api/inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('summary')
  summary(@CurrentUser() user: JWTPayload) {
    return this.service.summary(user.tenant_id);
  }

  @Get('items')
  list(@CurrentUser() user: JWTPayload, @Query('lowStock') lowStock?: string) {
    return this.service.list(user.tenant_id, { lowStockOnly: lowStock === 'true' });
  }

  @Get('items/:id')
  get(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.get(user.tenant_id, id);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateItemDto) {
    return this.service.create(user.tenant_id, dto, user.sub);
  }

  @Post('items/:id/adjust')
  @HttpCode(HttpStatus.OK)
  adjust(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: AdjustStockDto) {
    return this.service.adjustStock(user.tenant_id, id, dto, user.sub);
  }
}
