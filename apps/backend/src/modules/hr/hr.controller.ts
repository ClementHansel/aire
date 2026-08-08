import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { HrService, CreateEmployeeDto, UpdateEmployeeDto, LeaveRequestDto, ScheduleDto, HolidayDto } from './hr.service';

/** Outlet-bound roles are scoped to their own branch; tenant-wide roles can span all branches. */
const OUTLET_BOUND = (role: string) => role === Role.Cashier || role === Role.OutletAdmin;

// Granular RBAC: reads need hr.read (payroll.read also passes, since Payroll reads
// the employee list); writes need hr.write. Unrestricted users hold '*' so nothing
// changes until an owner assigns a restricted custom role.
@Controller('api/hr')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('hr.read', 'payroll.read')
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

  /**
   * The current user's branch context (from their linked employee + schedule):
   * today's scheduled branch, home branch, and the set of branches assigned to
   * them. Consumed by the POS (which branch to operate) and management scoping.
   */
  @Get('my/branch-context')
  @RequirePermission() /* POS-critical: every operator needs this regardless of HR access */
  myBranchContext(@CurrentUser() user: JWTPayload) {
    return this.service.getBranchContext(user.tenant_id, user.sub);
  }

  /** Link (or unlink, userId=null) an employee to a login account. */
  @Patch('employees/:id/link-user')
  @RequirePermission('hr.write')
  linkUser(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { userId: string | null }) {
    return this.service.linkUser(user.tenant_id, id, body?.userId ?? null);
  }

  /**
   * Who can be credited for a sale at a branch — NAMES ONLY, for the POS
   * salesperson picker (AIRIN-152).
   *
   * The full employee list needs `hr.read`, which a cashier has no business
   * holding: it carries salary, email and phone. But the cashier is exactly who
   * needs to say "this wash was Budi's sale" — so `/hr/employees` returned 403
   * and the picker silently degraded to a free-text box for every till in the
   * shop. This returns id + name + the link to their login (so the field can
   * preselect whoever is signed in) and nothing else, branch-scoped, behind the
   * same POS-critical exemption `my/branch-context` uses.
   */
  @Get('pos/salespeople')
  @RequirePermission() /* POS-critical: crediting a sale is a till action, not an HR one */
  salespeople(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    return this.service.listSalespeople(user.tenant_id, this.scope(user, outletId));
  }

  @Get('employees')
  employees(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string) {
    return this.service.listEmployees(user.tenant_id, this.scope(user, outletId));
  }

  @Post('employees')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('hr.write')
  createEmployee(@CurrentUser() user: JWTPayload, @Body() dto: CreateEmployeeDto) {
    // Outlet-bound staff can only add employees to their own branch.
    const outletId = OUTLET_BOUND(user.role) ? (user.outlet_id ?? undefined) : dto.outletId;
    return this.service.createEmployee(user.tenant_id, { ...dto, outletId }, user.sub);
  }

  /** Full profile + history for one employee (attendance, schedules, leave, payroll). */
  @Get('employees/:id')
  employee(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.getEmployeeDetail(user.tenant_id, id);
  }

  @Patch('employees/:id')
  @RequirePermission('hr.write')
  updateEmployee(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    const scoped = OUTLET_BOUND(user.role) ? { ...dto, outletId: undefined } : dto;
    return this.service.updateEmployee(user.tenant_id, id, scoped);
  }

  @Post('employees/:id/attendance')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('hr.write')
  attendance(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() body: { status?: string; checkIn?: string; checkOut?: string },
  ) {
    return this.service.recordAttendance(user.tenant_id, id, body, user.sub);
  }

  @Post('employees/:id/clock-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('hr.write')
  clockIn(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.service.clockIn(user.tenant_id, id, user.sub);
  }

  @Post('employees/:id/clock-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('hr.write')
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
  @RequirePermission('hr.write')
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
  @RequirePermission('hr.write')
  addHoliday(@CurrentUser() user: JWTPayload, @Body() dto: HolidayDto) {
    return this.service.addHoliday(user.tenant_id, dto, user.sub);
  }

  @Get('leave')
  leave(@CurrentUser() user: JWTPayload, @Query('status') status?: string) {
    return this.service.listLeave(user.tenant_id, status);
  }

  @Post('leave')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('hr.write')
  requestLeave(@CurrentUser() user: JWTPayload, @Body() dto: LeaveRequestDto) {
    return this.service.requestLeave(user.tenant_id, dto, user.sub);
  }

  @Patch('leave/:id')
  @RequirePermission('hr.write')
  resolveLeave(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() body: { status: 'approved' | 'rejected' }) {
    return this.service.resolveLeave(user.tenant_id, id, body.status, user.sub);
  }
}
