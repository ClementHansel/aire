import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ScopeService } from '../../common/scope/scope.service';
import { VoucherTicketService, SellBookDto } from './voucher-ticket.service';

/** Shareable digital vouchers (BRANCH-MMYYYY-NNNNNN). */
@Controller('api/voucher-tickets')
@UseGuards(JwtAuthGuard)
export class VoucherTicketController {
  constructor(
    private readonly service: VoucherTicketService,
    private readonly scope: ScopeService,
  ) {}

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

  /**
   * GET /api/voucher-tickets/books?dateFrom=&dateTo=&outletId= (AIRIN-133).
   * All three are optional; omitted means the full tenant list (unchanged
   * default for any existing caller).
   */
  @Get('books')
  async books(
    @CurrentUser() user: JWTPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
  ) {
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      throw new BadRequestException('Invalid dateFrom format. Use ISO date string.');
    }
    if (dateTo && isNaN(Date.parse(dateTo))) {
      throw new BadRequestException('Invalid dateTo format. Use ISO date string.');
    }
    // Explicit-only branch scoping, as on /memberships/manage. This list was
    // previously unrestricted for every role; silently narrowing it for
    // outlet-bound staff is a visibility change that belongs in its own decision,
    // not a side effect of adding reporting filters (AIRIN-133). Passing outletId
    // still goes through ScopeService, so a user cannot narrow to a branch they
    // are not assigned to.
    const outletIds = outletId ? await this.scope.resolveOutletIds(user, outletId) : undefined;
    return this.service.listBooks(user.tenant_id, { dateFrom, dateTo, outletIds });
  }

  @Get('books/:id/tickets')
  tickets(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.listTickets(user.tenant_id, id);
  }
}
