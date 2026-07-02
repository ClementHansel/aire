import {
  Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { SettlementService } from './settlement.service';

@Controller('api/settlement')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class SettlementController {
  constructor(private readonly service: SettlementService) {}

  @Get('summary')
  summary(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    return this.service.summary(user.tenant_id, outletId);
  }

  @Get('entries')
  entries(@CurrentUser() user: JWTPayload, @Query('owing') owing?: string, @Query('serving') serving?: string, @Query('status') status?: string) {
    return this.service.entries(user.tenant_id, owing, serving, status ?? 'pending');
  }

  @Get('payouts')
  payouts(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    return this.service.payouts(user.tenant_id, outletId);
  }

  @Post('payout')
  @HttpCode(HttpStatus.CREATED)
  payout(@CurrentUser() user: JWTPayload, @Body() body: { owingOutletId: string; servingOutletId: string; note?: string }) {
    return this.service.payout(user.tenant_id, body.owingOutletId, body.servingOutletId, user.sub, body.note);
  }
}
