import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { HrService, CreateEmployeeDto, LeaveRequestDto, ScheduleDto, HolidayDto } from './hr.service';

/** Outlet-bound roles are scoped to their own branch; tenant-wide roles can span all branches. */
const OUTLET_BOUND = (role: string) => role === Role.Cashier || role === Role.OutletAdmin;

@Controller('api/hr')
@UseGuards(JwtAuthGuard)
export class HrController {
  constructor(private readonly service: HrService) {}

  /** Effective branch scope: outlet-bound staff are pinned to their outlet; others may pass a filter. */
  private scope(user: JWTPayload, requested?: string): string | undefined {
    return OUTLET_BOUND(user.role) ? (user.outlet_id ?? undefined) : (requested || undefined);
  }

  @Get('summary')
  summary(@CurrentUser() user: JWTPayload) {
    return this.service.summary(user.tenant_id);
  }

  @Get('employees')
  employees(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    return this.service.listEmployees(user.tenant_id, this.scope(user, outletId));
  }

  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  createEmployee(@CurrentUser() user: JWTPayload, @Body() dto: CreateEmployeeDto) {
    // Outlet-bound staff can only add employees to their own branch.
    const outletId = OUTLET_BOUND(user.role) ? (user.outlet_id ?? undefined) : dto.outletId;
    return this.service.createEmployee(user.tenant_id, { ...dto, outletId }, user.sub);
  }

  @Post('employees/:id/attendance')
  @HttpCode(HttpStatus.CREATED)
  attendance(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { status?: string; checkIn?: string; checkOut?: string },
  ) {
    return this.service.recordAttendance(user.tenant_id, id, body, user.sub);
  }

  @Post('employees/:id/clock-in')
  @HttpCode(HttpStatus.OK)
  clockIn(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.clockIn(user.tenant_id, id, user.sub);
  }

  @Post('employees/:id/clock-out')
  @HttpCode(HttpStatus.OK)
  clockOut(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.clockOut(user.tenant_id, id, user.sub);
  }

  // ── Schedules ──
  @Get('schedules')
  schedules(
    @CurrentUser() user: JWTPayload,
    @Query('employeeId') employeeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('outletId') outletId?: string,
  ) {
    return this.service.listSchedules(user.tenant_id, { employeeId, dateFrom, dateTo, outletId: this.scope(user, outletId) });
  }

  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  setSchedule(@CurrentUser() user: JWTPayload, @Body() dto: ScheduleDto) {
    const outletId = OUTLET_BOUND(user.role) ? (user.outlet_id ?? undefined) : dto.outletId;
    return this.service.setSchedule(user.tenant_id, { ...dto, outletId }, user.sub);
  }

  // ── Holidays ──
  @Get('holidays')
  holidays(@CurrentUser() user: JWTPayload) {
    return this.service.listHolidays(user.tenant_id);
  }

  @Post('holidays')
  @HttpCode(HttpStatus.CREATED)
  addHoliday(@CurrentUser() user: JWTPayload, @Body() dto: HolidayDto) {
    return this.service.addHoliday(user.tenant_id, dto, user.sub);
  }

  @Get('leave')
  leave(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.listLeave(user.tenant_id, status);
  }

  @Post('leave')
  @HttpCode(HttpStatus.CREATED)
  requestLeave(@CurrentUser() user: JWTPayload, @Body() dto: LeaveRequestDto) {
    return this.service.requestLeave(user.tenant_id, dto, user.sub);
  }

  @Patch('leave/:id')
  resolveLeave(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { status: 'approved' | 'rejected' }) {
    return this.service.resolveLeave(user.tenant_id, id, body.status, user.sub);
  }
}
