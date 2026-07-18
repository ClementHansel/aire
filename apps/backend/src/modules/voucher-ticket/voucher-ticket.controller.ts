import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { VoucherTicketService, SellBookDto } from './voucher-ticket.service';

/** Shareable digital vouchers (BRANCH-MMYYYY-NNNNNN). */
@Controller('api/voucher-tickets')
@UseGuards(JwtAuthGuard)
export class VoucherTicketController {
  constructor(private readonly service: VoucherTicketService) {}

  @Post('sell')
  @HttpCode(HttpStatus.CREATED)
  sell(@CurrentUser() user: JWTPayload, @Body() dto: SellBookDto) {
    return this.service.sellBook(user, { ...dto, outletId: dto.outletId ?? user.outlet_id! });
  }

  @Get('validate')
  validate(@CurrentUser() user: JWTPayload, @Query('code') code: string) {
    return this.service.validate(user.tenant_id, code ?? '');
  }

  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  redeem(@CurrentUser() user: JWTPayload, @Body() body: { code: string; orderId?: string }) {
    return this.service.redeem(user.tenant_id, body.code, body.orderId, user.outlet_id ?? undefined);
  }

  @Get('books')
  books(@CurrentUser() user: JWTPayload) {
    return this.service.listBooks(user.tenant_id);
  }

  @Get('books/:id/tickets')
  tickets(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.listTickets(user.tenant_id, id);
  }
}
