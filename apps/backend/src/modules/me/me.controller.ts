import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { LeanDisabledGuard } from '../../common/guards';
import { MeService } from './me.service';

/**
 * Employee self-service API. Any authenticated login may call these; the service
 * resolves the caller's own linked employee and returns/writes only their data
 * (403 if the login has no employee record).
 *
 * Held while lean: employee self-service is disabled for the focused product, so
 * the whole controller returns 403 (LeanDisabledGuard). Remove that guard (or
 * flip LEAN_MODE) to restore it.
 */
@Controller('api/me')
@UseGuards(JwtAuthGuard, LeanDisabledGuard('Employee self-service'))
export class MeController {
  constructor(private readonly service: MeService) {}

  @Get('employee')
  employee(@CurrentUser() user: JWTPayload) {
    return this.service.profile(user.tenant_id, user.sub);
  }

  @Get('home')
  home(@CurrentUser() user: JWTPayload) {
    return this.service.home(user.tenant_id, user.sub);
  }

  @Get('schedule')
  schedule(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.schedule(user.tenant_id, user.sub, from, to);
  }

  @Get('attendance')
  attendance(@CurrentUser() user: JWTPayload) {
    return this.service.attendance(user.tenant_id, user.sub);
  }

  @Post('clock-in')
  @HttpCode(HttpStatus.OK)
  clockIn(@CurrentUser() user: JWTPayload) {
    return this.service.clockIn(user.tenant_id, user.sub);
  }

  @Post('clock-out')
  @HttpCode(HttpStatus.OK)
  clockOut(@CurrentUser() user: JWTPayload) {
    return this.service.clockOut(user.tenant_id, user.sub);
  }

  @Get('leave')
  leave(@CurrentUser() user: JWTPayload) {
    return this.service.leave(user.tenant_id, user.sub);
  }

  @Post('leave')
  @HttpCode(HttpStatus.CREATED)
  requestLeave(
    @CurrentUser() user: JWTPayload,
    @Body() body: { startDate: string; endDate: string; type?: string; reason?: string; paid?: boolean },
  ) {
    return this.service.requestLeave(user.tenant_id, user.sub, body);
  }

  @Get('loans')
  loans(@CurrentUser() user: JWTPayload) {
    return this.service.loans(user.tenant_id, user.sub);
  }

  @Get('payslips')
  payslips(@CurrentUser() user: JWTPayload) {
    return this.service.payslips(user.tenant_id, user.sub);
  }

  @Get('payslips/:id')
  payslip(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.payslip(user.tenant_id, user.sub, id);
  }
}
