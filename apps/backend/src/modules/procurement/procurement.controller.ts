import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ProcurementService, CreateSupplierDto, UpdateSupplierDto, CreatePoDto, ImportSupplierRow, CreateGrnDto } from './procurement.service';

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

  @Get('suppliers/:id')
  supplier(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getSupplier(user.tenant_id, id);
  }

  @Post('suppliers')
  @HttpCode(HttpStatus.CREATED)
  createSupplier(@CurrentUser() user: JWTPayload, @Body() dto: CreateSupplierDto) {
    return this.service.createSupplier(user.tenant_id, dto, user.sub);
  }

  @Post('suppliers/import')
  @HttpCode(HttpStatus.OK)
  importSuppliers(@CurrentUser() user: JWTPayload, @Body() body: { rows: ImportSupplierRow[] }) {
    return this.service.importSuppliers(user.tenant_id, body?.rows ?? []);
  }

  @Patch('suppliers/:id')
  updateSupplier(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.service.updateSupplier(user.tenant_id, id, dto);
  }

  @Delete('suppliers/:id')
  deactivateSupplier(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.deactivateSupplier(user.tenant_id, id);
  }

  @Get('purchase-orders')
  purchaseOrders(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.listPurchaseOrders(user.tenant_id, status);
  }

  @Get('purchase-orders/:id')
  purchaseOrder(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getPurchaseOrder(user.tenant_id, id);
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

  @Post('purchase-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelPo(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.cancelPurchaseOrder(user.tenant_id, id);
  }

  @Post('purchase-orders/:id/goods-receipts')
  @HttpCode(HttpStatus.CREATED)
  createGrn(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: CreateGrnDto) {
    return this.service.createGoodsReceipt(user.tenant_id, id, dto, user.sub);
  }

  @Get('purchase-orders/:id/goods-receipts')
  poGoodsReceipts(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.listGoodsReceipts(user.tenant_id, id);
  }

  @Get('goods-receipts/:id')
  goodsReceipt(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getGoodsReceipt(user.tenant_id, id);
  }
}
