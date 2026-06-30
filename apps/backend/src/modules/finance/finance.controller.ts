import { Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { FinanceService, RecordExpenseDto } from './finance.service';

@Controller('api/finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('summary')
  summary(@CurrentUser() user: JWTPayload, @Query('days') days?: string) {
    return this.service.summary(user.tenant_id, days ? parseInt(days, 10) : 30);
  }

  @Get('expenses')
  list(@CurrentUser() user: JWTPayload, @Query('limit') limit?: string) {
    return this.service.listExpenses(user.tenant_id, limit ? parseInt(limit, 10) : 50);
  }

  @Post('expenses')
  @HttpCode(HttpStatus.CREATED)
  record(@CurrentUser() user: JWTPayload, @Body() dto: RecordExpenseDto) {
    return this.service.recordExpense(user.tenant_id, dto, user.sub);
  }
}
