import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { RefundService, CreateRefundDto } from './refund.service';

@Controller('api/refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Cashier)
export class RefundController {
  constructor(private readonly service: RefundService) {}

  @Get()
  list(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.service.listRefunds(user.tenant_id, { from, to, outletId });
  }

  @Get('order/:orderId')
  byOrder(@CurrentUser() user: JWTPayload, @Param('orderId') orderId: string) {
    return this.service.listByOrder(user.tenant_id, orderId);
  }

  @Get('refundable/:orderId')
  refundable(@CurrentUser() user: JWTPayload, @Param('orderId') orderId: string) {
    return this.service.refundableLines(user.tenant_id, orderId);
  }

  @Get(':id')
  get(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getRefund(user.tenant_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateRefundDto) {
    return this.service.createRefund(user.tenant_id, dto, user);
  }

  /**
   * POST /api/refunds/:orderId/pin — issues a one-time 6-digit PIN (WhatsApp
   * to the tenant's escalation number, else emailed to the tenant owner)
   * authorizing a refund on this order past the free-window. Same posture as
   * the order-void PIN request: any signed-in cashier+ may request one;
   * createRefund is what actually enforces who needs it.
   */
  @Post(':orderId/pin')
  @HttpCode(HttpStatus.OK)
  requestPin(@CurrentUser() user: JWTPayload, @Param('orderId') orderId: string) {
    return this.service.requestRefundPin(orderId, user);
  }
}
