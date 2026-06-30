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

  async listEmployees(tenantId: string): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, name, role, phone, email, salary, status, hired_at, outlet_id
       FROM employees WHERE tenant_id = $1 ORDER BY name ASC`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id, name: r.name, role: r.role, phone: r.phone, email: r.email,
      salary: parseFloat(r.salary), status: r.status, hiredAt: r.hired_at, outletId: r.outlet_id,
    }));
  }

  async createEmployee(tenantId: string, dto: CreateEmployeeDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    const res = await this.pool.query(
      `INSERT INTO employees (tenant_id, outlet_id, name, role, phone, email, salary, hired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenantId, dto.outletId ?? null, dto.name.trim(), dto.role ?? null, dto.phone ?? null, dto.email ?? null, dto.salary ?? 0, dto.hiredAt ?? null],
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

  async listSchedules(tenantId: string, opts: { employeeId?: string; dateFrom?: string; dateTo?: string } = {}): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'es.tenant_id = $1';
    if (opts.employeeId) { params.push(opts.employeeId); where += ` AND es.employee_id = $${params.length}`; }
    if (opts.dateFrom) { params.push(opts.dateFrom); where += ` AND es.work_date >= $${params.length}::date`; }
    if (opts.dateTo) { params.push(opts.dateTo); where += ` AND es.work_date <= $${params.length}::date`; }
    const res = await this.pool.query(
      `SELECT es.id, es.work_date, es.start_time, es.end_time, es.notes, e.name AS employee, es.employee_id
       FROM employee_schedules es JOIN employees e ON e.id = es.employee_id
       WHERE ${where} ORDER BY es.work_date ASC, e.name ASC LIMIT 500`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, employee: r.employee, employeeId: r.employee_id, workDate: r.work_date,
      startTime: r.start_time, endTime: r.end_time, notes: r.notes,
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
