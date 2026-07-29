import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { HrService, LeaveRequestDto } from '../hr/hr.service';

/** The signed-in employee's own record, resolved from the JWT subject. */
interface EmployeeRow {
  id: string;
  outletId: string | null;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  salary: number;
  status: string;
  hiredAt: string | null;
  employmentType: string;
  outletName: string | null;
}

/**
 * Employee self-service. Every method resolves the caller's own employee record
 * from `employees.user_id = <jwt.sub>` and only ever returns/writes that
 * employee's data — a login can never read another employee through here.
 * Base salary is returned to the employee about themselves only; management-wide
 * salary access stays behind the HR/payroll (owner/admin) endpoints.
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly hr: HrService,
  ) {}

  /** Resolve the employee linked to this login, or 403 if there is none. */
  private async resolveEmployee(tenantId: string, userId: string): Promise<EmployeeRow> {
    const res = await this.pool.query(
      `SELECT e.id, e.outlet_id, e.name, e.role, e.phone, e.email, e.salary, e.status,
              e.hired_at, e.employment_type, o.name AS outlet_name
       FROM employees e
       LEFT JOIN outlets o ON o.id = e.outlet_id
       WHERE e.tenant_id = $1 AND e.user_id = $2 LIMIT 1`,
      [tenantId, userId],
    );
    const r = res.rows[0];
    if (!r) {
      throw new ForbiddenException(
        'This login is not linked to an employee record. Ask an administrator to link your account.',
      );
    }
    return {
      id: r.id,
      outletId: r.outlet_id ?? null,
      name: r.name,
      role: r.role ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      salary: parseFloat(r.salary ?? '0'),
      status: r.status,
      hiredAt: r.hired_at ?? null,
      employmentType: r.employment_type,
      outletName: r.outlet_name ?? null,
    };
  }

  /** Full profile + contract (incl. own base salary). */
  async profile(tenantId: string, userId: string): Promise<EmployeeRow> {
    return this.resolveEmployee(tenantId, userId);
  }

  /**
   * The cashier's authoritative operating branch for the POS header —
   * deliberately not gated by the employee-self-service lean flag (see
   * MePosController), since POS needs this whenever lean mode is on.
   *
   * Precedence: open POS shift's outlet, else the employee's home outlet.
   * The shift wins because that's the outlet order.service.ts actually books
   * orders to (`shift.outletId`) — matching it here is what fixes the header
   * showing a branch that isn't where sales are really landing (AIRIN-113).
   */
  async posBranch(tenantId: string, userId: string): Promise<{
    outletId: string | null;
    outletName: string | null;
    source: 'shift' | 'home' | null;
  }> {
    const shift = await this.pool.query<{ outlet_id: string; outlet_name: string | null }>(
      `SELECT ps.outlet_id, o.name AS outlet_name
       FROM pos_shifts ps LEFT JOIN outlets o ON o.id = ps.outlet_id
       WHERE ps.tenant_id = $1 AND ps.operator_id = $2 AND ps.status = 'open'
       ORDER BY ps.opened_at DESC LIMIT 1`,
      [tenantId, userId],
    );
    const s = shift.rows[0];
    if (s) return { outletId: s.outlet_id, outletName: s.outlet_name ?? null, source: 'shift' };

    const emp = await this.pool.query<{ outlet_id: string | null; outlet_name: string | null }>(
      `SELECT e.outlet_id, o.name AS outlet_name
       FROM employees e LEFT JOIN outlets o ON o.id = e.outlet_id
       WHERE e.tenant_id = $1 AND e.user_id = $2 AND e.status = 'active' LIMIT 1`,
      [tenantId, userId],
    );
    const e = emp.rows[0];
    if (e?.outlet_id) return { outletId: e.outlet_id, outletName: e.outlet_name ?? null, source: 'home' };
    return { outletId: null, outletName: null, source: null };
  }

  /** Home aggregate: profile + today's schedule + today's attendance state. */
  async home(tenantId: string, userId: string): Promise<Record<string, unknown>> {
    const emp = await this.resolveEmployee(tenantId, userId);
    const sched = await this.pool.query(
      `SELECT es.start_time, es.end_time, es.notes, es.outlet_id, o.name AS outlet_name
       FROM employee_schedules es LEFT JOIN outlets o ON o.id = es.outlet_id
       WHERE es.employee_id = $1 AND es.work_date = CURRENT_DATE LIMIT 1`,
      [emp.id],
    );
    const att = await this.pool.query(
      `SELECT check_in, check_out, status, hours_worked
       FROM attendance_records WHERE employee_id = $1 AND work_date = CURRENT_DATE LIMIT 1`,
      [emp.id],
    );
    const s = sched.rows[0];
    const a = att.rows[0];
    return {
      employee: emp,
      todaySchedule: s
        ? { startTime: s.start_time, endTime: s.end_time, notes: s.notes, outletName: s.outlet_name ?? null }
        : null,
      todayAttendance: a
        ? {
            checkIn: a.check_in,
            checkOut: a.check_out,
            status: a.status,
            hoursWorked: a.hours_worked != null ? parseFloat(a.hours_worked) : null,
          }
        : null,
    };
  }

  async schedule(tenantId: string, userId: string, from?: string, to?: string): Promise<unknown[]> {
    const emp = await this.resolveEmployee(tenantId, userId);
    return this.hr.listSchedules(tenantId, { employeeId: emp.id, dateFrom: from, dateTo: to });
  }

  async attendance(tenantId: string, userId: string): Promise<unknown[]> {
    const emp = await this.resolveEmployee(tenantId, userId);
    const res = await this.pool.query(
      `SELECT work_date, check_in, check_out, status, hours_worked
       FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY work_date DESC LIMIT 90`,
      [tenantId, emp.id],
    );
    return res.rows.map((r) => ({
      workDate: r.work_date,
      checkIn: r.check_in,
      checkOut: r.check_out,
      status: r.status,
      hoursWorked: r.hours_worked != null ? parseFloat(r.hours_worked) : null,
    }));
  }

  async clockIn(tenantId: string, userId: string): Promise<Record<string, unknown>> {
    const emp = await this.resolveEmployee(tenantId, userId);
    return this.hr.clockIn(tenantId, emp.id, userId);
  }

  async clockOut(tenantId: string, userId: string): Promise<Record<string, unknown>> {
    const emp = await this.resolveEmployee(tenantId, userId);
    return this.hr.clockOut(tenantId, emp.id, userId);
  }

  async leave(tenantId: string, userId: string): Promise<unknown[]> {
    const emp = await this.resolveEmployee(tenantId, userId);
    const res = await this.pool.query(
      `SELECT id, start_date, end_date, type, reason, status, paid, created_at, resolved_at
       FROM leave_requests WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY created_at DESC LIMIT 100`,
      [tenantId, emp.id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      startDate: r.start_date,
      endDate: r.end_date,
      type: r.type,
      reason: r.reason,
      status: r.status,
      paid: r.paid,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }));
  }

  async requestLeave(
    tenantId: string,
    userId: string,
    dto: Omit<LeaveRequestDto, 'employeeId'>,
  ): Promise<Record<string, unknown>> {
    const emp = await this.resolveEmployee(tenantId, userId);
    // Force the employeeId to the caller's own record — never trust a body value.
    return this.hr.requestLeave(tenantId, { ...dto, employeeId: emp.id }, userId);
  }

  async loans(tenantId: string, userId: string): Promise<unknown[]> {
    const emp = await this.resolveEmployee(tenantId, userId);
    const loans = await this.pool.query(
      `SELECT id, principal, balance, monthly_installment, reason, status, created_at
       FROM employee_loans WHERE tenant_id = $1 AND employee_id = $2
       ORDER BY created_at DESC LIMIT 100`,
      [tenantId, emp.id],
    );
    if (loans.rows.length === 0) return [];
    const ids = loans.rows.map((r) => r.id);
    const reps = await this.pool.query(
      `SELECT loan_id, amount, period, method, created_at
       FROM loan_repayments WHERE loan_id = ANY($1::uuid[])
       ORDER BY created_at DESC`,
      [ids],
    );
    const byLoan = new Map<string, unknown[]>();
    for (const r of reps.rows) {
      const arr = byLoan.get(r.loan_id) ?? [];
      arr.push({ amount: parseFloat(r.amount), period: r.period, method: r.method, createdAt: r.created_at });
      byLoan.set(r.loan_id, arr);
    }
    return loans.rows.map((r) => ({
      id: r.id,
      principal: parseFloat(r.principal),
      balance: parseFloat(r.balance),
      monthlyInstallment: parseFloat(r.monthly_installment),
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      repayments: byLoan.get(r.id) ?? [],
    }));
  }

  /** My payslips — only from FINALIZED payroll runs (drafts stay internal). */
  async payslips(tenantId: string, userId: string): Promise<unknown[]> {
    const emp = await this.resolveEmployee(tenantId, userId);
    const res = await this.pool.query(
      `SELECT p.id, r.period, r.finalized_at
       FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
       WHERE p.tenant_id = $1 AND p.employee_id = $2 AND r.status = 'finalized'
       ORDER BY r.period DESC`,
      [tenantId, emp.id],
    );
    return res.rows.map((r) => ({ id: r.id, period: r.period, finalizedAt: r.finalized_at }));
  }

  async payslip(tenantId: string, userId: string, payslipId: string): Promise<Record<string, unknown>> {
    const emp = await this.resolveEmployee(tenantId, userId);
    const res = await this.pool.query(
      `SELECT p.*, r.period, r.finalized_at, r.status AS run_status
       FROM payslips p JOIN payroll_runs r ON r.id = p.payroll_run_id
       WHERE p.id = $1 AND p.tenant_id = $2 AND p.employee_id = $3 AND r.status = 'finalized' LIMIT 1`,
      [payslipId, tenantId, emp.id],
    );
    const s = res.rows[0];
    if (!s) throw new NotFoundException('Payslip not found');
    return {
      id: s.id,
      period: s.period,
      finalizedAt: s.finalized_at,
      employeeName: s.employee_name,
      baseSalary: parseFloat(s.base_salary),
      scheduledDays: s.scheduled_days,
      daysWorked: s.days_worked,
      unpaidLeaveDays: s.unpaid_leave_days,
      bonusTotal: parseFloat(s.bonus_total),
      deductionTotal: parseFloat(s.deduction_total),
      advanceTotal: parseFloat(s.advance_total),
      loanRepaymentTotal: parseFloat(s.loan_repayment_total),
      unpaidLeaveDeduction: parseFloat(s.unpaid_leave_deduction),
      grossPay: parseFloat(s.gross_pay),
      netPay: parseFloat(s.net_pay),
    };
  }
}
