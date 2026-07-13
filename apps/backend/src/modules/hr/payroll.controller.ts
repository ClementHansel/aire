import {
  Controller, Get, Post, Body, Param, Query, Res, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PayrollService, AdjustmentDto, LoanDto } from './payroll.service';

// Reads need payroll.read; writes need payroll.write. Zero-regression: unrestricted
// users hold '*'; only a restricted custom role is gated.
@Controller('api/payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('payroll.read')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  // ── Adjustments (bonus / deduction / advance) ──
  @Get('adjustments')
  adjustments(@CurrentUser() user: JWTPayload, @Query('period') period?: string, @Query('employeeId') employeeId?: string) {
    return this.service.listAdjustments(user.tenant_id, { period, employeeId });
  }

  @Post('adjustments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('payroll.write')
  addAdjustment(@CurrentUser() user: JWTPayload, @Body() dto: AdjustmentDto) {
    return this.service.addAdjustment(user.tenant_id, dto, user.sub);
  }

  // ── Loans ──
  @Get('loans')
  loans(@CurrentUser() user: JWTPayload, @Query('status') status?: string, @Query('employeeId') employeeId?: string) {
    return this.service.listLoans(user.tenant_id, { status, employeeId });
  }

  @Post('loans')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('payroll.write')
  createLoan(@CurrentUser() user: JWTPayload, @Body() dto: LoanDto) {
    return this.service.createLoan(user.tenant_id, dto, user.sub);
  }

  @Post('loans/:id/repay')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.write')
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
  @RequirePermission('payroll.write')
  generate(@CurrentUser() user: JWTPayload, @Body() body: { period: string; workingDays?: number }) {
    if (!body?.period) throw new BadRequestException('period (YYYY-MM) is required');
    return this.service.generatePayroll(user.tenant_id, body.period, body.workingDays ?? 26, user.sub);
  }

  /** One-click: generate + finalize a period using the tenant's default working-days. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.write')
  runNow(@CurrentUser() user: JWTPayload, @Body() body: { period?: string }) {
    const period = body?.period ?? new Date().toISOString().slice(0, 7);
    return this.service.runPayroll(user.tenant_id, period, user.sub);
  }

  @Post('runs/:id/finalize')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payroll.write')
  finalize(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.finalize(user.tenant_id, id, user.sub);
  }

  @Get('runs/:id/export')
  async export(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.service.exportCsv(user.tenant_id, id);
    res
      .set('Content-Type', 'text/csv')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  }
}
