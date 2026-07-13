import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface CreateEmployeeDto {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  salary?: number;
  outletId?: string;
  hiredAt?: string;
  employmentType?: 'permanent' | 'contract';
  userId?: string | null;
}

export interface UpdateEmployeeDto {
  name?: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  salary?: number;
  outletId?: string | null;
  hiredAt?: string | null;
  employmentType?: 'permanent' | 'contract';
  status?: 'active' | 'inactive';
}

/**
 * Which branch(es) a logged-in user operates, derived from their linked HR
 * employee record and work schedule. Consumed by the POS (today's branch) and
 * management views (the set of branches they're assigned to).
 */
export interface BranchContext {
  employeeId: string | null;
  homeOutletId: string | null;   // the employee's base outlet
  todayOutletId: string | null;  // scheduled branch for CURRENT_DATE, if any
  todayScheduled: boolean;
  todayStartTime: string | null; // scheduled shift start (HH:MM), if rostered today
  todayEndTime: string | null;   // scheduled shift end (HH:MM), if rostered today
  assignedOutletIds: string[];   // union of every branch they're scheduled at (+ home)
  branches: { id: string; name: string }[]; // all active tenant branches (for the POS override picker)
}

export interface LeaveRequestDto {
  employeeId: string;
  startDate: string;
  endDate: string;
  type?: string;
  reason?: string;
  paid?: boolean;
}

export interface ScheduleDto {
  employeeId: string;
  workDate: string;
  startTime?: string;
  endTime?: string;
  outletId?: string;
  notes?: string;
}

export interface HolidayDto {
  date: string;
  name: string;
  isPaid?: boolean;
}

/**
 * HrService — employees, attendance, leave. Self-reliant CRUD; emits events.
 */
@Injectable()
export class HrService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async listEmployees(tenantId: string, outletId?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'e.tenant_id = $1';
    if (outletId) { params.push(outletId); where += ` AND e.outlet_id = $${params.length}`; }
    const res = await this.pool.query(
      `SELECT e.id, e.name, e.role, e.phone, e.email, e.salary, e.status, e.hired_at, e.employment_type,
              e.outlet_id, o.name AS outlet_name, e.user_id, u.email AS user_email
       FROM employees e
       LEFT JOIN outlets o ON o.id = e.outlet_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE ${where} ORDER BY e.name ASC`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, name: r.name, role: r.role, phone: r.phone, email: r.email,
      salary: parseFloat(r.salary), status: r.status, hiredAt: r.hired_at, employmentType: r.employment_type,
      outletId: r.outlet_id, outletName: r.outlet_name ?? null,
      userId: r.user_id ?? null, userEmail: r.user_email ?? null,
    }));
  }

  /**
   * Full profile + history for one employee: attendance summary, upcoming/recent
   * schedules, leave, payroll adjustments, loans (+ repayments) and payslip
   * history across runs. Powers the HR employee-detail drawer.
   */
  async getEmployeeDetail(tenantId: string, employeeId: string): Promise<Record<string, unknown>> {
    const empRes = await this.pool.query(
      `SELECT e.id, e.name, e.role, e.phone, e.email, e.salary, e.status, e.hired_at, e.employment_type,
              e.outlet_id, o.name AS outlet_name, e.user_id, u.email AS user_email, e.created_at
       FROM employees e
       LEFT JOIN outlets o ON o.id = e.outlet_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [employeeId, tenantId],
    );
    if (empRes.rows.length === 0) throw new NotFoundException('Employee not found');
    const e = empRes.rows[0]!;

    const [attendance, schedules, leave, adjustments, loans, payslips] = await Promise.all([
      // Recent attendance (last 30 rows) + this-month present/late/absent counts.
      this.pool.query(
        `SELECT work_date, status, check_in, check_out, hours_worked
         FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2
         ORDER BY work_date DESC LIMIT 30`,
        [tenantId, employeeId],
      ),
      this.pool.query(
        `SELECT es.id, es.work_date, es.start_time, es.end_time, es.notes, es.outlet_id, o.name AS outlet_name
         FROM employee_schedules es LEFT JOIN outlets o ON o.id = es.outlet_id
         WHERE es.tenant_id = $1 AND es.employee_id = $2
         ORDER BY es.work_date DESC LIMIT 30`,
        [tenantId, employeeId],
      ),
      this.pool.query(
        `SELECT id, start_date, end_date, type, reason, status, paid
         FROM leave_requests WHERE tenant_id = $1 AND employee_id = $2
         ORDER BY start_date DESC LIMIT 50`,
        [tenantId, employeeId],
      ),
      this.pool.query(
        `SELECT pa.id, pa.type, pa.amount, pa.reason, pa.effective_period, pa.status, pa.recurring, pa.total_periods,
                (SELECT COUNT(*) FROM payroll_adjustment_applications a WHERE a.adjustment_id = pa.id) AS applied_count
         FROM payroll_adjustments pa WHERE pa.tenant_id = $1 AND pa.employee_id = $2
         ORDER BY pa.created_at DESC LIMIT 100`,
        [tenantId, employeeId],
      ),
      this.pool.query(
        `SELECT id, principal, balance, monthly_installment, reason, status, created_at
         FROM employee_loans WHERE tenant_id = $1 AND employee_id = $2
         ORDER BY created_at DESC LIMIT 50`,
        [tenantId, employeeId],
      ),
      this.pool.query(
        `SELECT ps.id, ps.base_salary, ps.bonus_total, ps.deduction_total, ps.advance_total,
                ps.loan_repayment_total, ps.unpaid_leave_deduction, ps.gross_pay, ps.net_pay,
                ps.days_worked, ps.scheduled_days, pr.period, pr.status, pr.finalized_at
         FROM payslips ps JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
         WHERE ps.tenant_id = $1 AND ps.employee_id = $2
         ORDER BY pr.period DESC LIMIT 24`,
        [tenantId, employeeId],
      ),
    ]);

    const monthPrefix = new Date().toISOString().slice(0, 7);
    const att = attendance.rows;
    const attendanceThisMonth = {
      present: att.filter((r) => String(r.work_date).slice(0, 7) === monthPrefix && (r.status === 'present' || r.status === 'late')).length,
      absent: att.filter((r) => String(r.work_date).slice(0, 7) === monthPrefix && r.status === 'absent').length,
    };

    return {
      id: e.id, name: e.name, role: e.role, phone: e.phone, email: e.email,
      salary: parseFloat(e.salary), status: e.status, hiredAt: e.hired_at, employmentType: e.employment_type,
      outletId: e.outlet_id, outletName: e.outlet_name ?? null,
      userId: e.user_id ?? null, userEmail: e.user_email ?? null, createdAt: e.created_at,
      attendanceThisMonth,
      attendance: att.map((r) => ({ workDate: r.work_date, status: r.status, checkIn: r.check_in, checkOut: r.check_out, hoursWorked: r.hours_worked == null ? null : parseFloat(r.hours_worked) })),
      schedules: schedules.rows.map((r) => ({ id: r.id, workDate: r.work_date, startTime: r.start_time, endTime: r.end_time, notes: r.notes, outletId: r.outlet_id, outletName: r.outlet_name ?? null })),
      leave: leave.rows.map((r) => ({ id: r.id, startDate: r.start_date, endDate: r.end_date, type: r.type, reason: r.reason, status: r.status, paid: r.paid })),
      adjustments: adjustments.rows.map((r) => ({ id: r.id, type: r.type, amount: parseFloat(r.amount), reason: r.reason, period: r.effective_period, status: r.status, recurring: r.recurring, totalPeriods: r.total_periods, appliedCount: parseInt(r.applied_count, 10) || 0 })),
      loans: loans.rows.map((r) => ({ id: r.id, principal: parseFloat(r.principal), balance: parseFloat(r.balance), monthlyInstallment: parseFloat(r.monthly_installment), reason: r.reason, status: r.status, createdAt: r.created_at })),
      payslips: payslips.rows.map((r) => ({ id: r.id, period: r.period, runStatus: r.status, finalizedAt: r.finalized_at, baseSalary: parseFloat(r.base_salary), bonusTotal: parseFloat(r.bonus_total), deductionTotal: parseFloat(r.deduction_total), advanceTotal: parseFloat(r.advance_total), loanRepaymentTotal: parseFloat(r.loan_repayment_total), unpaidLeaveDeduction: parseFloat(r.unpaid_leave_deduction), grossPay: parseFloat(r.gross_pay), netPay: parseFloat(r.net_pay), daysWorked: r.days_worked, scheduledDays: r.scheduled_days })),
    };
  }

  /** Update an employee's profile fields (partial). */
  async updateEmployee(tenantId: string, employeeId: string, dto: UpdateEmployeeDto): Promise<Record<string, unknown>> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (dto.name !== undefined) set('name', dto.name);
    if (dto.role !== undefined) set('role', dto.role);
    if (dto.phone !== undefined) set('phone', dto.phone);
    if (dto.email !== undefined) set('email', dto.email);
    if (dto.salary !== undefined) set('salary', dto.salary);
    if (dto.outletId !== undefined) set('outlet_id', dto.outletId);
    if (dto.hiredAt !== undefined) set('hired_at', dto.hiredAt);
    if (dto.employmentType !== undefined) set('employment_type', dto.employmentType);
    if (dto.status !== undefined) set('status', dto.status);
    if (sets.length === 0) throw new BadRequestException('No fields to update');
    sets.push('updated_at = NOW()');
    params.push(employeeId, tenantId);
    const res = await this.pool.query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING id, name, status, employment_type`,
      params,
    );
    if (res.rows.length === 0) throw new NotFoundException('Employee not found');
    return { id: res.rows[0]!.id, name: res.rows[0]!.name, status: res.rows[0]!.status, employmentType: res.rows[0]!.employment_type };
  }

  /**
   * Link (or unlink) an employee to a login account. The user must belong to the
   * same tenant. Passing userId = null clears the link.
   */
  async linkUser(tenantId: string, employeeId: string, userId: string | null): Promise<{ id: string; userId: string | null }> {
    if (userId) {
      const u = await this.pool.query(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
      if (u.rows.length === 0) throw new BadRequestException('User not found in this tenant');
    }
    const res = await this.pool.query<{ id: string; user_id: string | null }>(
      `UPDATE employees SET user_id = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, user_id`,
      [userId, employeeId, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Employee not found');
    return { id: res.rows[0]!.id, userId: res.rows[0]!.user_id };
  }

  /**
   * Resolve a logged-in user's branch context from their linked employee + schedule.
   * When the user has no linked employee, everything is null/empty and callers
   * fall back to the user's own JWT outlet_id (backward compatible).
   */
  async getBranchContext(tenantId: string, userId: string): Promise<BranchContext> {
    const branchesRes = await this.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM outlets WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
      [tenantId],
    );
    const branches = branchesRes.rows.map((r) => ({ id: r.id, name: r.name }));

    const empRes = await this.pool.query<{ id: string; outlet_id: string | null }>(
      `SELECT id, outlet_id FROM employees WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [tenantId, userId],
    );
    if (empRes.rows.length === 0) {
      return { employeeId: null, homeOutletId: null, todayOutletId: null, todayScheduled: false, todayStartTime: null, todayEndTime: null, assignedOutletIds: [], branches };
    }
    const emp = empRes.rows[0]!;
    const todayRes = await this.pool.query<{ outlet_id: string | null; start_time: string | null; end_time: string | null }>(
      `SELECT outlet_id, start_time, end_time FROM employee_schedules WHERE employee_id = $1 AND work_date = CURRENT_DATE LIMIT 1`,
      [emp.id],
    );
    const assignedRes = await this.pool.query<{ outlet_id: string }>(
      `SELECT DISTINCT outlet_id FROM employee_schedules WHERE employee_id = $1 AND outlet_id IS NOT NULL`,
      [emp.id],
    );
    const assigned = new Set<string>(assignedRes.rows.map((r) => r.outlet_id));
    if (emp.outlet_id) assigned.add(emp.outlet_id);
    const today = todayRes.rows[0]?.outlet_id ?? null;
    const todayRow = todayRes.rows[0];
    return {
      employeeId: emp.id,
      homeOutletId: emp.outlet_id,
      todayOutletId: today,
      todayScheduled: today != null,
      todayStartTime: todayRow?.start_time ?? null,
      todayEndTime: todayRow?.end_time ?? null,
      assignedOutletIds: [...assigned],
      branches,
    };
  }

  async createEmployee(tenantId: string, dto: CreateEmployeeDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query(
      `INSERT INTO employees (tenant_id, outlet_id, name, role, phone, email, salary, hired_at, employment_type, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'permanent'),$10) RETURNING *`,
      [tenantId, dto.outletId ?? null, dto.name.trim(), dto.role ?? null, dto.phone ?? null, dto.email ?? null, dto.salary ?? 0, dto.hiredAt ?? null, dto.employmentType ?? null, dto.userId ?? null],
    );
    const e = res.rows[0]!;
    void this.eventBus?.emit({
      type: DomainEventType.EmployeeAdded,
      tenantId, actor: actor ?? 'system',
      payload: { employeeId: e.id, name: e.name, role: e.role },
    });
    return { id: e.id, name: e.name, role: e.role, status: e.status };
  }

  async recordAttendance(
    tenantId: string,
    employeeId: string,
    body: { status?: string; checkIn?: string; checkOut?: string },
    actor?: string,
  ): Promise<Record<string, unknown>> {
    const emp = await this.pool.query(`SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`, [employeeId, tenantId]);
    if (emp.rows.length === 0) throw new NotFoundException('Employee not found');
    // Upsert one row per employee per day.
    const res = await this.pool.query(
      `INSERT INTO attendance_records (tenant_id, employee_id, status, check_in, check_out)
       VALUES ($1,$2,COALESCE($3,'present'),$4,$5)
       ON CONFLICT (employee_id, work_date) DO UPDATE
         SET status = COALESCE(EXCLUDED.status, attendance_records.status),
             check_in = COALESCE(EXCLUDED.check_in, attendance_records.check_in),
             check_out = COALESCE(EXCLUDED.check_out, attendance_records.check_out)
       RETURNING id, work_date, status`,
      [tenantId, employeeId, body.status ?? null, body.checkIn ?? null, body.checkOut ?? null],
    );
    void this.eventBus?.emit({
      type: DomainEventType.AttendanceRecorded,
      tenantId, actor: actor ?? 'system',
      payload: { employeeId, status: res.rows[0]!.status },
    });
    return res.rows[0]!;
  }

  /** Clock in for today (log in). */
  async clockIn(tenantId: string, employeeId: string, actor?: string): Promise<Record<string, unknown>> {
    const emp = await this.pool.query(`SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`, [employeeId, tenantId]);
    if (emp.rows.length === 0) throw new NotFoundException('Employee not found');
    const res = await this.pool.query(
      `INSERT INTO attendance_records (tenant_id, employee_id, status, check_in)
       VALUES ($1,$2,'present',NOW())
       ON CONFLICT (employee_id, work_date) DO UPDATE
         SET check_in = COALESCE(attendance_records.check_in, NOW()),
             status = CASE WHEN attendance_records.status = 'absent' THEN 'present' ELSE attendance_records.status END
       RETURNING id, work_date, check_in`,
      [tenantId, employeeId],
    );
    void this.eventBus?.emit({ type: DomainEventType.Clocked, tenantId, actor: actor ?? employeeId, payload: { employeeId, action: 'in' } });
    return res.rows[0]!;
  }

  /** Clock out for today (log out) — computes hours worked. */
  async clockOut(tenantId: string, employeeId: string, actor?: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query(
      `UPDATE attendance_records
       SET check_out = NOW(),
           hours_worked = ROUND(EXTRACT(EPOCH FROM (NOW() - check_in)) / 3600.0, 2)
       WHERE employee_id = $1 AND tenant_id = $2 AND work_date = CURRENT_DATE AND check_in IS NOT NULL
       RETURNING id, work_date, hours_worked`,
      [employeeId, tenantId],
    );
    if (res.rows.length === 0) throw new BadRequestException('No open clock-in found for today');
    void this.eventBus?.emit({ type: DomainEventType.Clocked, tenantId, actor: actor ?? employeeId, payload: { employeeId, action: 'out', hours: res.rows[0]!.hours_worked } });
    return res.rows[0]!;
  }

  // ─── Schedules ────────────────────────────────────────────────────────────

  async setSchedule(tenantId: string, dto: ScheduleDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.employeeId || !dto.workDate) throw new BadRequestException('employeeId and workDate are required');
    const res = await this.pool.query(
      `INSERT INTO employee_schedules (tenant_id, employee_id, outlet_id, work_date, start_time, end_time, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (employee_id, work_date) DO UPDATE
         SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, notes = EXCLUDED.notes, outlet_id = EXCLUDED.outlet_id
       RETURNING id, work_date`,
      [tenantId, dto.employeeId, dto.outletId ?? null, dto.workDate, dto.startTime ?? null, dto.endTime ?? null, dto.notes ?? null],
    );
    void this.eventBus?.emit({ type: DomainEventType.ScheduleSet, tenantId, actor: actor ?? 'system', payload: { employeeId: dto.employeeId, workDate: dto.workDate } });
    return res.rows[0]!;
  }

  async listSchedules(tenantId: string, opts: { employeeId?: string; dateFrom?: string; dateTo?: string; outletId?: string } = {}): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'es.tenant_id = $1';
    if (opts.employeeId) { params.push(opts.employeeId); where += ` AND es.employee_id = $${params.length}`; }
    if (opts.outletId) { params.push(opts.outletId); where += ` AND es.outlet_id = $${params.length}`; }
    if (opts.dateFrom) { params.push(opts.dateFrom); where += ` AND es.work_date >= $${params.length}::date`; }
    if (opts.dateTo) { params.push(opts.dateTo); where += ` AND es.work_date <= $${params.length}::date`; }
    const res = await this.pool.query(
      `SELECT es.id, es.work_date, es.start_time, es.end_time, es.notes, e.name AS employee, es.employee_id,
              es.outlet_id, o.name AS outlet_name
       FROM employee_schedules es
       JOIN employees e ON e.id = es.employee_id
       LEFT JOIN outlets o ON o.id = es.outlet_id
       WHERE ${where} ORDER BY es.work_date ASC, e.name ASC LIMIT 500`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, employee: r.employee, employeeId: r.employee_id, workDate: r.work_date,
      startTime: r.start_time, endTime: r.end_time, notes: r.notes,
      outletId: r.outlet_id, outletName: r.outlet_name ?? null,
    }));
  }

  // ─── Holidays ─────────────────────────────────────────────────────────────

  async listHolidays(tenantId: string): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, holiday_date, name, is_paid FROM holidays WHERE tenant_id = $1 ORDER BY holiday_date DESC LIMIT 200`,
      [tenantId],
    );
    return res.rows.map((r) => ({ id: r.id, date: r.holiday_date, name: r.name, isPaid: r.is_paid }));
  }

  async addHoliday(tenantId: string, dto: HolidayDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.date || !dto.name?.trim()) throw new BadRequestException('date and name are required');
    const res = await this.pool.query(
      `INSERT INTO holidays (tenant_id, holiday_date, name, is_paid)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, holiday_date) DO UPDATE SET name = EXCLUDED.name, is_paid = EXCLUDED.is_paid
       RETURNING id, holiday_date, name`,
      [tenantId, dto.date, dto.name.trim(), dto.isPaid ?? true],
    );
    void this.eventBus?.emit({ type: DomainEventType.HolidayAdded, tenantId, actor: actor ?? 'system', payload: { date: dto.date, name: dto.name.trim() } });
    return { id: res.rows[0]!.id, date: res.rows[0]!.holiday_date, name: res.rows[0]!.name };
  }

  async listLeave(tenantId: string, status?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'lr.tenant_id = $1';
    if (status) {
      params.push(status);
      where += ` AND lr.status = $${params.length}`;
    }
    const res = await this.pool.query(
      `SELECT lr.id, lr.start_date, lr.end_date, lr.type, lr.reason, lr.status, e.name AS employee
       FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
       WHERE ${where} ORDER BY lr.created_at DESC LIMIT 200`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, employee: r.employee, startDate: r.start_date, endDate: r.end_date,
      type: r.type, reason: r.reason, status: r.status,
    }));
  }

  async requestLeave(tenantId: string, dto: LeaveRequestDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.employeeId || !dto.startDate || !dto.endDate) {
      throw new BadRequestException('employeeId, startDate and endDate are required');
    }
    const res = await this.pool.query(
      `INSERT INTO leave_requests (tenant_id, employee_id, start_date, end_date, type, reason, paid)
       VALUES ($1,$2,$3,$4,COALESCE($5,'annual'),$6,$7) RETURNING id, status`,
      [tenantId, dto.employeeId, dto.startDate, dto.endDate, dto.type ?? null, dto.reason ?? null, dto.paid ?? true],
    );
    void this.eventBus?.emit({
      type: DomainEventType.LeaveRequested,
      tenantId, actor: actor ?? 'system',
      payload: { leaveId: res.rows[0]!.id, employeeId: dto.employeeId },
    });
    return res.rows[0]!;
  }

  async resolveLeave(tenantId: string, id: string, status: 'approved' | 'rejected', actor?: string): Promise<Record<string, unknown>> {
    if (!['approved', 'rejected'].includes(status)) throw new BadRequestException('status must be approved or rejected');
    const res = await this.pool.query(
      `UPDATE leave_requests SET status = $1, resolved_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending' RETURNING id, status`,
      [status, id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Pending leave request not found');
    void this.eventBus?.emit({
      type: DomainEventType.LeaveResolved,
      tenantId, actor: actor ?? 'system',
      payload: { leaveId: id, status },
    });
    return res.rows[0]!;
  }

  async summary(tenantId: string): Promise<Record<string, unknown>> {
    const headcount = await this.pool.query<{ active: string; payroll: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
              COALESCE(SUM(salary) FILTER (WHERE status = 'active'), 0) AS payroll
       FROM employees WHERE tenant_id = $1`,
      [tenantId],
    );
    const presentToday = await this.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT employee_id) AS count FROM attendance_records
       WHERE tenant_id = $1 AND work_date = CURRENT_DATE AND status IN ('present','late')`,
      [tenantId],
    );
    const pendingLeave = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM leave_requests WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId],
    );
    return {
      activeEmployees: parseInt(headcount.rows[0]!.active, 10),
      monthlyPayroll: parseFloat(headcount.rows[0]!.payroll),
      presentToday: parseInt(presentToday.rows[0]!.count, 10),
      pendingLeaveRequests: parseInt(pendingLeave.rows[0]!.count, 10),
    };
  }
}
