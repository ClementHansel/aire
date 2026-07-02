import { Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { FinanceService, RecordExpenseDto } from './finance.service';

/** Outlet-scoped roles can't narrow to an arbitrary branch; owners/admins can. */
function scopedOutletId(user: JWTPayload, outletId?: string): string | undefined {
  return user.role === Role.Cashier || user.role === Role.OutletAdmin ? undefined : outletId;
}

@Controller('api/finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('summary')
  summary(@CurrentUser() user: JWTPayload, @Query('days') days?: string, @Query('outletId') outletId?: string) {
    return this.service.summary(user.tenant_id, days ? parseInt(days, 10) : 30, scopedOutletId(user, outletId));
  }

  @Get('expenses')
  list(@CurrentUser() user: JWTPayload, @Query('limit') limit?: string, @Query('outletId') outletId?: string) {
    return this.service.listExpenses(user.tenant_id, limit ? parseInt(limit, 10) : 50, scopedOutletId(user, outletId));
  }

  @Post('expenses')
  @HttpCode(HttpStatus.CREATED)
  record(@CurrentUser() user: JWTPayload, @Body() dto: RecordExpenseDto) {
    return this.service.recordExpense(user.tenant_id, dto, user.sub);
  }
}
