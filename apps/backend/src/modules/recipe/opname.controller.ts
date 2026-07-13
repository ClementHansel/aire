import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { OpnameService } from './opname.service';

/** Stock opname (physical count) sessions. Outlet Admin and above. */
@Controller('api/opname')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OpnameController {
  constructor(private readonly service: OpnameService) {}

  @Get()
  @Roles(Role.OutletAdmin)
  list(@CurrentUser() user: JWTPayload) {
    return this.service.list(user.tenant_id);
  }

  @Post()
  @Roles(Role.OutletAdmin)
  create(@CurrentUser() user: JWTPayload, @Body() body: { outletId?: string; note?: string }) {
    return this.service.create(user.tenant_id, body?.outletId ?? null, body?.note, user.sub);
  }

  @Get(':id')
  @Roles(Role.OutletAdmin)
  get(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.get(user.tenant_id, id);
  }

  /** Inventory items that can still be added to this opname's count sheet. */
  @Get(':id/available')
  @Roles(Role.OutletAdmin)
  available(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.availableItems(user.tenant_id, id);
  }

  @Post(':id/items')
  @Roles(Role.OutletAdmin)
  addItem(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { inventoryItemId: string }) {
    return this.service.addItem(user.tenant_id, id, body.inventoryItemId);
  }

  @Patch(':id/items/:itemId')
  @Roles(Role.OutletAdmin)
  setCount(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: { countedQty: number | null }) {
    return this.service.setCount(user.tenant_id, id, itemId, body.countedQty);
  }

  @Post(':id/close')
  @Roles(Role.OutletAdmin)
  close(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.close(user.tenant_id, id, user.sub);
  }

  @Delete(':id')
  @Roles(Role.OutletAdmin)
  remove(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.remove(user.tenant_id, id);
  }
}
