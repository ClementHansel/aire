import { Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ScopeService } from '../../common/scope/scope.service';
import { FinanceService, RecordExpenseDto } from './finance.service';

@Controller('api/finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(
    private readonly service: FinanceService,
    private readonly scope: ScopeService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: JWTPayload, @Query('days') days?: string, @Query('outletId') outletId?: string) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.service.summary(user.tenant_id, days ? parseInt(days, 10) : 30, ids);
  }

  @Get('expenses')
  async list(@CurrentUser() user: JWTPayload, @Query('limit') limit?: string, @Query('outletId') outletId?: string) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.service.listExpenses(user.tenant_id, limit ? parseInt(limit, 10) : 50, ids);
  }

  @Post('expenses')
  @HttpCode(HttpStatus.CREATED)
  record(@CurrentUser() user: JWTPayload, @Body() dto: RecordExpenseDto) {
    return this.service.recordExpense(user.tenant_id, dto, user.sub);
  }
}
