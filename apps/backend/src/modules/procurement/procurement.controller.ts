import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ProcurementService, CreateSupplierDto, CreatePoDto } from './procurement.service';

@Controller('api/procurement')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  @Get('summary')
  summary(@CurrentUser() user: JWTPayload) {
    return this.service.summary(user.tenant_id);
  }

  @Get('suppliers')
  suppliers(@CurrentUser() user: JWTPayload) {
    return this.service.listSuppliers(user.tenant_id);
  }

  @Post('suppliers')
  @HttpCode(HttpStatus.CREATED)
  createSupplier(@CurrentUser() user: JWTPayload, @Body() dto: CreateSupplierDto) {
    return this.service.createSupplier(user.tenant_id, dto, user.sub);
  }

  @Get('purchase-orders')
  purchaseOrders(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.listPurchaseOrders(user.tenant_id, status);
  }

  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  createPo(@CurrentUser() user: JWTPayload, @Body() dto: CreatePoDto) {
    return this.service.createPurchaseOrder(user.tenant_id, dto, user.sub);
  }

  @Post('purchase-orders/:id/receive')
  @HttpCode(HttpStatus.OK)
  receivePo(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.receivePurchaseOrder(user.tenant_id, id, user.sub);
  }
}
