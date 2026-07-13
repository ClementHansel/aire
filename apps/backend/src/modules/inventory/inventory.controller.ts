import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ScopeService } from '../../common/scope/scope.service';
import { InventoryService, CreateItemDto, AdjustStockDto, UpdateItemDto, ImportItemRow } from './inventory.service';

@Controller('api/inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly scope: ScopeService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.service.summary(user.tenant_id, ids);
  }

  @Get('items')
  async list(@CurrentUser() user: JWTPayload, @Query('lowStock') lowStock?: string, @Query('outletId') outletId?: string) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.service.list(user.tenant_id, { lowStockOnly: lowStock === 'true', outletIds: ids });
  }

  @Get('categories')
  categories(@CurrentUser() user: JWTPayload) {
    return this.service.categories(user.tenant_id);
  }

  @Get('items/:id')
  get(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.get(user.tenant_id, id);
  }

  @Get('items/:id/movements')
  movements(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.listMovements(user.tenant_id, id, limit ? parseInt(limit, 10) : 50);
  }

  @Get('items/:id/sources')
  sources(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.listSources(user.tenant_id, id);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateItemDto) {
    return this.service.create(user.tenant_id, dto, user.sub);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  import(@CurrentUser() user: JWTPayload, @Body() body: { rows: ImportItemRow[] }) {
    return this.service.importItems(user.tenant_id, body?.rows ?? [], user.sub);
  }

  @Patch('items/:id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.service.update(user.tenant_id, id, dto, user.sub);
  }

  @Delete('items/:id')
  deactivate(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.deactivate(user.tenant_id, id);
  }

  @Post('items/:id/adjust')
  @HttpCode(HttpStatus.OK)
  adjust(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: AdjustStockDto) {
    return this.service.adjustStock(user.tenant_id, id, dto, user.sub);
  }
}
