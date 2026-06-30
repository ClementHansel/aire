import {
  Controller, Get, Post, Body, Param, Query, Res, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { PayrollService, AdjustmentDto, LoanDto } from './payroll.service';

@Controller('api/payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  // ── Adjustments (bonus / deduction / advance) ──
  @Get('adjustments')
  adjustments(@CurrentUser() user: JWTPayload, @Query('period') period?: string) {
    return this.service.listAdjustments(user.tenant_id, period);
  }

  @Post('adjustments')
  @HttpCode(HttpStatus.CREATED)
  addAdjustment(@CurrentUser() user: JWTPayload, @Body() dto: AdjustmentDto) {
    return this.service.addAdjustment(user.tenant_id, dto, user.sub);
  }

  // ── Loans ──
  @Get('loans')
  loans(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.listLoans(user.tenant_id, status);
  }

  @Post('loans')
  @HttpCode(HttpStatus.CREATED)
  createLoan(@CurrentUser() user: JWTPayload, @Body() dto: LoanDto) {
    return this.service.createLoan(user.tenant_id, dto, user.sub);
  }

  @Post('loans/:id/repay')
  @HttpCode(HttpStatus.OK)
  repay(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { amount: number }) {
    return this.service.recordManualRepayment(user.tenant_id, id, body.amount, user.sub);
  }

  // ── Payroll runs ──
  @Get('runs')
  runs(@CurrentUser() user: JWTPayload) {
    return this.service.listRuns(user.tenant_id);
  }

  @Get('runs/:id')
  run(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getRun(user.tenant_id, id);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  generate(@CurrentUser() user: JWTPayload, @Body() body: { period: string; workingDays?: number }) {
    if (!body?.period) throw new BadRequestException('period (YYYY-MM) is required');
    return this.service.generatePayroll(user.tenant_id, body.period, body.workingDays ?? 26, user.sub);
  }

  @Post('runs/:id/finalize')
  @HttpCode(HttpStatus.OK)
  finalize(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.finalize(user.tenant_id, id, user.sub);
  }

  @Get('runs/:id/export')
  async export(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Res() reply: FastifyReply) {
    const { filename, csv } = await this.service.exportCsv(user.tenant_id, id);
    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  }
}
