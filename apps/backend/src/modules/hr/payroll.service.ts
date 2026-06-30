import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';

export interface AdjustmentDto {
  employeeId: string;
  type: 'bonus' | 'deduction' | 'advance';
  amount: number;
  reason?: string;
  period: string; // YYYY-MM
}
export interface LoanDto {
  employeeId: string;
  principal: number;
  monthlyInstallment: number;
  reason?: string;
}

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * PayrollService — bonus/deduction/advance adjustments, employee loans +
 * repayments, and transactional payroll generation that rolls salary,
 * adjustments, unpaid leave, and loan installments into payslips.
 *
 * Generation is idempotent per period: regenerating a draft run reverses its
 * applied adjustments and loan repayments first. Finalized runs are locked.
 */
@Injectable()
export class PayrollService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  // ─── Adjustments ────────────────────────────────────────────────────────────

  async addAdjustment(tenantId: string, dto: AdjustmentDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.employeeId) throw new BadRequestException('employeeId is required');
    if (!['bonus', 'deduction', 'advance'].includes(dto.type)) throw new BadRequestException('Invalid adjustment type');
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('amount must be positive');
    if (!PERIOD_RE.test(dto.period)) throw new BadRequestException('period must be YYYY-MM');
    const res = await this.pool.query(
      `INSERT INTO payroll_adjustments (tenant_id, employee_id, type, amount, reason, effective_period, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, type, amount, effective_period, status`,
      [tenantId, dto.employeeId, dto.type, dto.amount, dto.reason ?? null, dto.period, actor ?? null],
    );
    void this.eventBus?.emit({ type: DomainEventType.PayrollAdjustmentAdded, tenantId, actor: actor ?? 'system', payload: { type: dto.type, amount: dto.amount, period: dto.period, employeeId: dto.employeeId } });
    return res.rows[0]!;
  }

  async listAdjustments(tenantId: string, period?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'pa.tenant_id = $1';
    if (period) { params.push(period); where += ` AND pa.effective_period = $${params.length}`; }
    const res = await this.pool.query(
      `SELECT pa.id, pa.type, pa.amount, pa.reason, pa.effective_period, pa.status, e.name AS employee, pa.employee_id
       FROM payroll_adjustments pa JOIN employees e ON e.id = pa.employee_id
       WHERE ${where} ORDER BY pa.created_at DESC LIMIT 300`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, employee: r.employee, employeeId: r.employee_id, type: r.type,
      amount: parseFloat(r.amount), reason: r.reason, period: r.effective_period, status: r.status,
    }));
  }

  // ─── Loans ────────────────────────────────────────────────────────────────

  async createLoan(tenantId: string, dto: LoanDto, actor?: string): Promise<Record<string, unknown>> {
    if (!dto.employeeId) throw new BadRequestException('employeeId is required');
    if (!dto.principal || dto.principal <= 0) throw new BadRequestException('principal must be positive');
    if (!dto.monthlyInstallment || dto.monthlyInstallment <= 0) throw new BadRequestException('monthlyInstallment must be positive');
    const res = await this.pool.query(
      `INSERT INTO employee_loans (tenant_id, employee_id, principal, balance, monthly_installment, reason, created_by)
       VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id, balance`,
      [tenantId, dto.employeeId, dto.principal, dto.monthlyInstallment, dto.reason ?? null, actor ?? null],
    );
    void this.eventBus?.emit({ type: DomainEventType.LoanCreated, tenantId, actor: actor ?? 'system', payload: { loanId: res.rows[0]!.id, employeeId: dto.employeeId, principal: dto.principal } });
    return { id: res.rows[0]!.id, balance: parseFloat(res.rows[0]!.balance) };
  }

  async listLoans(tenantId: string, status?: string): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'l.tenant_id = $1';
    if (status) { params.push(status); where += ` AND l.status = $${params.length}`; }
    const res = await this.pool.query(
      `SELECT l.id, l.principal, l.balance, l.monthly_installment, l.reason, l.status, e.name AS employee, l.employee_id
       FROM employee_loans l JOIN employees e ON e.id = l.employee_id
       WHERE ${where} ORDER BY l.created_at DESC LIMIT 200`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id, employee: r.employee, employeeId: r.employee_id,
      principal: parseFloat(r.principal), balance: parseFloat(r.balance),
      monthlyInstallment: parseFloat(r.monthly_installment), reason: r.reason, status: r.status,
    }));
  }

  async recordManualRepayment(tenantId: string, loanId: string, amount: number, actor?: string): Promise<Record<string, unknown>> {
    if (!amount || amount <= 0) throw new BadRequestException('amount must be positive');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const loan = await client.query<{ balance: string }>(
        `SELECT balance FROM employee_loans WHERE id = $1 AND tenant_id = $2 AND status = 'active' FOR UPDATE`,
        [loanId, tenantId],
      );
      if (loan.rows.length === 0) throw new NotFoundException('Active loan not found');
      const balance = parseFloat(loan.rows[0]!.balance);
      const pay = Math.min(amount, balance);
      const newBalance = balance - pay;
      await client.query(
        `UPDATE employee_loans SET balance = $1, status = CASE WHEN $1 <= 0 THEN 'paid' ELSE status END, updated_at = NOW() WHERE id = $2`,
        [newBalance, loanId],
      );
      await client.query(
        `INSERT INTO loan_repayments (tenant_id, loan_id, amount, method) VALUES ($1,$2,$3,'manual')`,
        [tenantId, loanId, pay],
      );
      await client.query('COMMIT');
      void this.eventBus?.emit({ type: DomainEventType.LoanRepaid, tenantId, actor: actor ?? 'system', payload: { loanId, amount: pay, method: 'manual', remaining: newBalance } });
      return { loanId, paid: pay, remainingBalance: newBalance };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Payroll runs ───────────────────────────────────────────────────────────

  async listRuns(tenantId: string): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, period, status, working_days, employee_count, total_gross, total_net, created_at, finalized_at
       FROM payroll_runs WHERE tenant_id = $1 ORDER BY period DESC, created_at DESC LIMIT 50`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id, period: r.period, status: r.status, workingDays: r.working_days,
      employeeCount: r.employee_count, totalGross: parseFloat(r.total_gross), totalNet: parseFloat(r.total_net),
      createdAt: r.created_at, finalizedAt: r.finalized_at,
    }));
  }

  async getRun(tenantId: string, runId: string): Promise<Record<string, unknown>> {
    const run = await this.pool.query(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tenantId]);
    if (run.rows.length === 0) throw new NotFoundException('Payroll run not found');
    const slips = await this.pool.query(`SELECT * FROM payslips WHERE payroll_run_id = $1 ORDER BY employee_name ASC`, [runId]);
    const r = run.rows[0]!;
    return {
      id: r.id, period: r.period, status: r.status, workingDays: r.working_days,
      employeeCount: r.employee_count, totalGross: parseFloat(r.total_gross), totalNet: parseFloat(r.total_net),
      createdAt: r.created_at, finalizedAt: r.finalized_at,
      payslips: slips.rows.map(this.mapPayslip),
    };
  }

  async finalize(tenantId: string, runId: string, actor?: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query(
      `UPDATE payroll_runs SET status = 'finalized', finalized_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'draft' RETURNING id, period`,
      [runId, tenantId],
    );
    if (res.rows.length === 0) throw new BadRequestException('Draft payroll run not found (already finalized?)');
    void this.eventBus?.emit({ type: DomainEventType.PayrollFinalized, tenantId, actor: actor ?? 'system', payload: { runId, period: res.rows[0]!.period } });
    return { id: runId, status: 'finalized' };
  }

  async exportCsv(tenantId: string, runId: string): Promise<{ filename: string; csv: string }> {
    const run = await this.getRun(tenantId, runId);
    const slips = run.payslips as Record<string, unknown>[];
    const headers = ['Employee', 'Base Salary', 'Scheduled Days', 'Days Worked', 'Unpaid Leave Days', 'Bonus', 'Deductions', 'Advance', 'Loan Repayment', 'Unpaid Leave Deduction', 'Gross', 'Net'];
    const lines = [headers.join(',')];
    for (const s of slips) {
      lines.push([
        this.csv(String(s.employeeName ?? '')), s.baseSalary, s.scheduledDays, s.daysWorked, s.unpaidLeaveDays,
        s.bonusTotal, s.deductionTotal, s.advanceTotal, s.loanRepaymentTotal, s.unpaidLeaveDeduction, s.grossPay, s.netPay,
      ].join(','));
    }
    return { filename: `payroll-${run.period}.csv`, csv: lines.join('\n') };
  }

  /**
   * Generate (or regenerate) a draft payroll run for a YYYY-MM period.
   * Rolls base salary + bonuses − deductions − advances − loan installments −
   * unpaid-leave deductions into one payslip per active employee.
   */
  async generatePayroll(tenantId: string, period: string, workingDays = 26, actor?: string): Promise<Record<string, unknown>> {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('period must be YYYY-MM');
    if (workingDays <= 0) throw new BadRequestException('workingDays must be positive');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Reverse + delete an existing draft run for this period (idempotent).
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM payroll_runs WHERE tenant_id = $1 AND period = $2`,
        [tenantId, period],
      );
      for (const row of existing.rows) {
        if (row.status === 'finalized') {
          throw new BadRequestException(`Payroll for ${period} is finalized and cannot be regenerated`);
        }
        await this.reverseRun(client, tenantId, row.id);
      }

      const runRes = await client.query<{ id: string }>(
        `INSERT INTO payroll_runs (tenant_id, period, status, working_days, generated_by)
         VALUES ($1,$2,'draft',$3,$4) RETURNING id`,
        [tenantId, period, workingDays, actor ?? null],
      );
      const runId = runRes.rows[0]!.id;

      const employees = await client.query<{ id: string; name: string; salary: string }>(
        `SELECT id, name, salary FROM employees WHERE tenant_id = $1 AND status = 'active' ORDER BY name`,
        [tenantId],
      );

      let totalGross = 0;
      let totalNet = 0;
      const perDayBase = workingDays > 0 ? 1 / workingDays : 0;

      for (const emp of employees.rows) {
        const base = parseFloat(emp.salary);

        // Adjustments (pending, this period) → apply.
        const adj = await client.query<{ type: string; sum: string }>(
          `SELECT type, COALESCE(SUM(amount),0) AS sum FROM payroll_adjustments
           WHERE tenant_id = $1 AND employee_id = $2 AND effective_period = $3 AND status = 'pending'
           GROUP BY type`,
          [tenantId, emp.id, period],
        );
        let bonus = 0, deduction = 0, advance = 0;
        for (const a of adj.rows) {
          if (a.type === 'bonus') bonus = parseFloat(a.sum);
          else if (a.type === 'deduction') deduction = parseFloat(a.sum);
          else if (a.type === 'advance') advance = parseFloat(a.sum);
        }
        await client.query(
          `UPDATE payroll_adjustments SET status = 'applied', applied_run_id = $1
           WHERE tenant_id = $2 AND employee_id = $3 AND effective_period = $4 AND status = 'pending'`,
          [runId, tenantId, emp.id, period],
        );

        // Loan installments for active loans.
        let loanRepayment = 0;
        const loans = await client.query<{ id: string; balance: string; monthly_installment: string }>(
          `SELECT id, balance, monthly_installment FROM employee_loans
           WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active' AND balance > 0 FOR UPDATE`,
          [tenantId, emp.id],
        );
        for (const loan of loans.rows) {
          const balance = parseFloat(loan.balance);
          const pay = Math.min(parseFloat(loan.monthly_installment), balance);
          if (pay <= 0) continue;
          const newBalance = balance - pay;
          await client.query(
            `UPDATE employee_loans SET balance = $1, status = CASE WHEN $1 <= 0 THEN 'paid' ELSE status END, updated_at = NOW() WHERE id = $2`,
            [newBalance, loan.id],
          );
          await client.query(
            `INSERT INTO loan_repayments (tenant_id, loan_id, amount, period, method, run_id) VALUES ($1,$2,$3,$4,'payroll',$5)`,
            [tenantId, loan.id, pay, period, runId],
          );
          loanRepayment += pay;
        }

        // Unpaid leave days overlapping the period.
        const leaveRes = await client.query<{ days: string }>(
          `SELECT COALESCE(SUM(
              GREATEST(0,
                (LEAST(end_date, (to_date($3,'YYYY-MM') + INTERVAL '1 month - 1 day')::date)
                 - GREATEST(start_date, to_date($3,'YYYY-MM')::date)) + 1
              )
            ), 0) AS days
           FROM leave_requests
           WHERE tenant_id = $1 AND employee_id = $2 AND status = 'approved' AND paid = false
             AND start_date <= (to_date($3,'YYYY-MM') + INTERVAL '1 month - 1 day')::date
             AND end_date >= to_date($3,'YYYY-MM')::date`,
          [tenantId, emp.id, period],
        );
        const unpaidLeaveDays = parseInt(leaveRes.rows[0]!.days, 10) || 0;
        const unpaidLeaveDeduction = Math.round(base * perDayBase * unpaidLeaveDays);

        // Attendance + schedule counts (informational on the payslip).
        const counts = await client.query<{ worked: string; scheduled: string }>(
          `SELECT
             (SELECT COUNT(*) FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2
                AND status IN ('present','late') AND to_char(work_date,'YYYY-MM') = $3) AS worked,
             (SELECT COUNT(*) FROM employee_schedules WHERE tenant_id = $1 AND employee_id = $2
                AND to_char(work_date,'YYYY-MM') = $3) AS scheduled`,
          [tenantId, emp.id, period],
        );
        const daysWorked = parseInt(counts.rows[0]!.worked, 10) || 0;
        const scheduledDays = parseInt(counts.rows[0]!.scheduled, 10) || 0;

        const gross = base + bonus;
        const net = gross - deduction - advance - loanRepayment - unpaidLeaveDeduction;

        await client.query(
          `INSERT INTO payslips
            (payroll_run_id, tenant_id, employee_id, employee_name, base_salary, scheduled_days, days_worked,
             unpaid_leave_days, bonus_total, deduction_total, advance_total, loan_repayment_total,
             unpaid_leave_deduction, gross_pay, net_pay)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [runId, tenantId, emp.id, emp.name, base, scheduledDays, daysWorked, unpaidLeaveDays,
           bonus, deduction, advance, loanRepayment, unpaidLeaveDeduction, gross, net],
        );
        totalGross += gross;
        totalNet += net;
      }

      await client.query(
        `UPDATE payroll_runs SET employee_count = $1, total_gross = $2, total_net = $3 WHERE id = $4`,
        [employees.rows.length, totalGross, totalNet, runId],
      );
      await client.query('COMMIT');

      void this.eventBus?.emit({ type: DomainEventType.PayrollGenerated, tenantId, actor: actor ?? 'system', payload: { runId, period, employees: employees.rows.length, totalNet } });
      return this.getRun(tenantId, runId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Reverse an applied draft run: restore adjustments + loan balances, delete payslips + run. */
  private async reverseRun(client: PoolClient, tenantId: string, runId: string): Promise<void> {
    // Restore loan balances from this run's repayments.
    const reps = await client.query<{ loan_id: string; amount: string }>(
      `SELECT loan_id, amount FROM loan_repayments WHERE run_id = $1`,
      [runId],
    );
    for (const r of reps.rows) {
      await client.query(
        `UPDATE employee_loans SET balance = balance + $1, status = 'active', updated_at = NOW() WHERE id = $2`,
        [parseFloat(r.amount), r.loan_id],
      );
    }
    await client.query(`DELETE FROM loan_repayments WHERE run_id = $1`, [runId]);
    // Un-apply adjustments.
    await client.query(
      `UPDATE payroll_adjustments SET status = 'pending', applied_run_id = NULL WHERE applied_run_id = $1`,
      [runId],
    );
    await client.query(`DELETE FROM payslips WHERE payroll_run_id = $1`, [runId]);
    await client.query(`DELETE FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tenantId]);
  }

  private mapPayslip = (s: Record<string, any>): Record<string, unknown> => ({
    id: s.id,
    employeeId: s.employee_id,
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
  });

  private csv(v: string): string {
    return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  }
}
