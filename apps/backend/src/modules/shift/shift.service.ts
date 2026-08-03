import { Injectable, Inject, Optional, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { JWTPayload } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import { leanModeEnabled } from '../../common/lean';

export interface OpenShiftDto { openingFloat?: number; outletId?: string; offScheduleReason?: string; }
export interface CloseShiftDto { countedCash: number; notes?: string; }
export interface PettyCashDto { type: 'in' | 'out'; amount: number; category?: string; reason?: string; }
export interface ShiftIssueDto { severity?: 'low' | 'medium' | 'high'; description: string; }

/**
 * ShiftService — POS register sessions (open/close), petty cash, and issues.
 *
 * A shift records who worked (operator + open/close times = attendance), the
 * opening cash float, all petty-cash movements, any issues, and reconciles
 * counted vs expected cash at close. Orders are linked to the open shift so
 * sales can be reported shift-by-shift. Self-reliant; emits events.
 */
@Injectable()
export class ShiftService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** Open a register shift for the operator. Only one open shift per operator. */
  async open(user: JWTPayload, dto: OpenShiftDto): Promise<Record<string, unknown>> {
    const outletId = dto.outletId ?? user.outlet_id;
    if (!outletId) throw new BadRequestException('An outlet is required to open a shift');

    const existing = await this.pool.query(
      `SELECT id FROM pos_shifts WHERE operator_id = $1 AND status = 'open'`,
      [user.sub],
    );
    if (existing.rows.length > 0) throw new ConflictException('You already have an open shift. Close it first.');

    // Attendance gate: a cashier opening a shift while off-schedule (working a
    // branch they're not scheduled at) or with no schedule today (e.g. late /
    // unscheduled login) must give a reason here — once, at login/shift start —
    // rather than being asked on every order in the POS.
    //
    // Skipped entirely while lean mode holds HR: with the scheduling UI hidden,
    // NO employee can ever have a roster, so the gate degraded into a permanent
    // "you have no schedule today" nag on every shift open (Samuel 2026-08-03).
    // It comes back automatically with HR when LEAN_MODE flips off.
    const scheduleGateOn = !leanModeEnabled();
    const sched = scheduleGateOn
      ? await this.pool.query<{ today: string | null }>(
          `SELECT es.outlet_id AS today
           FROM employees e
           LEFT JOIN employee_schedules es ON es.employee_id = e.id AND es.work_date = CURRENT_DATE
           WHERE e.tenant_id = $1 AND e.user_id = $2 AND e.status = 'active'
           LIMIT 1`,
          [user.tenant_id, user.sub],
        )
      : null;
    const scheduledToday = sched?.rows[0]?.today ?? null;
    const noSchedule = scheduledToday == null;
    const offSchedule = scheduleGateOn && (noSchedule || scheduledToday !== outletId);
    const reason = dto.offScheduleReason?.trim();
    if (offSchedule && !reason) {
      throw new BadRequestException(
        noSchedule
          ? 'You have no schedule today — a reason is required to open a shift.'
          : 'You are not scheduled at this branch today — a reason is required to open a shift.',
      );
    }

    const nameRes = await this.pool.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [user.sub]);
    const operatorName = nameRes.rows[0]?.name ?? null;

    const res = await this.pool.query(
      `INSERT INTO pos_shifts (tenant_id, outlet_id, operator_id, operator_name, opening_float)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user.tenant_id, outletId, user.sub, operatorName, dto.openingFloat ?? 0],
    );
    const s = res.rows[0]!;

    if (offSchedule && reason) {
      await this.pool.query(
        `INSERT INTO audit_logs (tenant_id, outlet_id, user_id, operation, entity_type, metadata)
         VALUES ($1, $2, $3, 'pos.shift_off_schedule', 'shift', $4)`,
        [user.tenant_id, outletId, user.sub, JSON.stringify({ reason, scheduledOutletId: scheduledToday, noSchedule, shiftId: s.id })],
      );
    }
    void this.eventBus?.emit({
      type: DomainEventType.ShiftOpened,
      tenantId: user.tenant_id, outletId, actor: user.sub,
      payload: { shiftId: s.id, openingFloat: parseFloat(s.opening_float) },
    });
    return this.mapShift(s);
  }

  /** Close a shift, reconciling counted vs expected cash. */
  async close(user: JWTPayload, shiftId: string, dto: CloseShiftDto): Promise<Record<string, unknown>> {
    if (dto.countedCash === undefined || dto.countedCash === null) {
      throw new BadRequestException('countedCash is required');
    }
    const shiftRes = await this.pool.query(
      `SELECT * FROM pos_shifts WHERE id = $1 AND tenant_id = $2`,
      [shiftId, user.tenant_id],
    );
    const shift = shiftRes.rows[0];
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === 'closed') throw new BadRequestException('Shift is already closed');

    const sales = await this.shiftSales(shiftId);
    const petty = await this.pettyTotals(shiftId);
    const openingFloat = parseFloat(shift.opening_float);
    const expected = openingFloat + sales.cash + petty.in - petty.out;
    const variance = dto.countedCash - expected;

    const res = await this.pool.query(
      `UPDATE pos_shifts
       SET status = 'closed', closed_at = NOW(),
           closing_counted = $1, expected_cash = $2, variance = $3,
           cash_sales = $4, non_cash_sales = $5, total_sales = $6, order_count = $7, notes = $8
       WHERE id = $9 RETURNING *`,
      [dto.countedCash, expected, variance, sales.cash, sales.nonCash, sales.total, sales.count, dto.notes ?? null, shiftId],
    );
    const s = res.rows[0]!;
    void this.eventBus?.emit({
      type: DomainEventType.ShiftClosed,
      tenantId: user.tenant_id, outletId: shift.outlet_id, actor: user.sub,
      payload: { shiftId, expected, counted: dto.countedCash, variance, totalSales: sales.total, orders: sales.count },
    });
    return this.mapShift(s);
  }

  /**
   * The open shift a branch-level order (e.g. a self-service kiosk) should be
   * booked into. This is the SINGLE seam for that decision: today it returns the
   * branch's sole open shift, or the earliest-opened when several cashiers are
   * open. The later HR-driven rule (schedule + `multiCashier`/`cashiersPerBranch`
   * setting) replaces only this method's body — callers never change. `hint` is
   * reserved for that rule (e.g. a specific register/operator).
   */
  async resolveBranchShift(
    tenantId: string,
    outletId: string,
    _hint?: string,
  ): Promise<{ id: string; outletId: string } | null> {
    const res = await this.pool.query<{ id: string; outlet_id: string }>(
      `SELECT id, outlet_id FROM pos_shifts
       WHERE tenant_id = $1 AND outlet_id = $2 AND status = 'open'
       ORDER BY opened_at ASC LIMIT 1`,
      [tenantId, outletId],
    );
    const r = res.rows[0];
    return r ? { id: r.id, outletId: r.outlet_id } : null;
  }

  /** The operator's current open shift, if any. */
  async current(user: JWTPayload): Promise<Record<string, unknown> | null> {
    const res = await this.pool.query(
      `SELECT * FROM pos_shifts WHERE operator_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [user.sub],
    );
    if (res.rows.length === 0) return null;
    return this.details(user.tenant_id, res.rows[0]!.id);
  }

  /** Full shift detail: figures, petty cash, issues. */
  async details(tenantId: string, shiftId: string): Promise<Record<string, unknown>> {
    const res = await this.pool.query(`SELECT * FROM pos_shifts WHERE id = $1 AND tenant_id = $2`, [shiftId, tenantId]);
    const shift = res.rows[0];
    if (!shift) throw new NotFoundException('Shift not found');
    const sales = await this.shiftSales(shiftId);
    const petty = await this.pettyTotals(shiftId);
    const movements = await this.pool.query(
      `SELECT id, type, amount, category, reason, created_at FROM petty_cash_movements WHERE shift_id = $1 ORDER BY created_at`,
      [shiftId],
    );
    const issues = await this.pool.query(
      `SELECT id, severity, description, created_at FROM shift_issues WHERE shift_id = $1 ORDER BY created_at`,
      [shiftId],
    );
    const openingFloat = parseFloat(shift.opening_float);
    return {
      ...this.mapShift(shift),
      liveSales: sales,
      pettyCash: {
        in: petty.in, out: petty.out,
        movements: movements.rows.map((m) => ({ id: m.id, type: m.type, amount: parseFloat(m.amount), category: m.category, reason: m.reason, at: m.created_at })),
      },
      expectedCashSoFar: openingFloat + sales.cash + petty.in - petty.out,
      issues: issues.rows.map((i) => ({ id: i.id, severity: i.severity, description: i.description, at: i.created_at })),
    };
  }

  async list(tenantId: string, opts: { outletId?: string; dateFrom?: string; dateTo?: string; limit?: number } = {}): Promise<unknown[]> {
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1';
    if (opts.outletId) { params.push(opts.outletId); where += ` AND outlet_id = $${params.length}`; }
    if (opts.dateFrom) { params.push(opts.dateFrom); where += ` AND opened_at >= $${params.length}::timestamptz`; }
    if (opts.dateTo) { params.push(opts.dateTo); where += ` AND opened_at < ($${params.length}::date + INTERVAL '1 day')`; }
    params.push(Math.min(opts.limit ?? 50, 200));
    const res = await this.pool.query(
      `SELECT * FROM pos_shifts WHERE ${where} ORDER BY opened_at DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((s) => this.mapShift(s));
  }

  async addPettyCash(user: JWTPayload, shiftId: string, dto: PettyCashDto): Promise<Record<string, unknown>> {
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('amount must be positive');
    if (!['in', 'out'].includes(dto.type)) throw new BadRequestException('type must be in or out');
    await this.assertOpenShift(user.tenant_id, shiftId);
    const res = await this.pool.query(
      `INSERT INTO petty_cash_movements (tenant_id, shift_id, type, amount, category, reason, actor)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [user.tenant_id, shiftId, dto.type, dto.amount, dto.category ?? null, dto.reason ?? null, user.sub],
    );
    void this.eventBus?.emit({
      type: DomainEventType.PettyCashRecorded,
      tenantId: user.tenant_id, actor: user.sub,
      payload: { shiftId, type: dto.type, amount: dto.amount, category: dto.category },
    });
    return { id: res.rows[0]!.id, type: dto.type, amount: dto.amount };
  }

  async addIssue(user: JWTPayload, shiftId: string, dto: ShiftIssueDto): Promise<Record<string, unknown>> {
    if (!dto.description?.trim()) throw new BadRequestException('description is required');
    await this.assertShift(user.tenant_id, shiftId);
    const res = await this.pool.query(
      `INSERT INTO shift_issues (tenant_id, shift_id, severity, description, reported_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [user.tenant_id, shiftId, dto.severity ?? 'low', dto.description.trim(), user.sub],
    );
    void this.eventBus?.emit({
      type: DomainEventType.ShiftIssueReported,
      tenantId: user.tenant_id, actor: user.sub,
      payload: { shiftId, severity: dto.severity ?? 'low', description: dto.description.trim() },
    });
    return { id: res.rows[0]!.id, severity: dto.severity ?? 'low' };
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private async shiftSales(shiftId: string): Promise<{ cash: number; nonCash: number; total: number; count: number }> {
    const res = await this.pool.query<{ cash: string; noncash: string; total: string; count: string }>(
      `SELECT
         COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash'), 0) AS cash,
         COALESCE(SUM(total) FILTER (WHERE payment_method IS NOT NULL AND payment_method <> 'cash'), 0) AS noncash,
         COALESCE(SUM(total), 0) AS total,
         COUNT(*) AS count
       FROM orders WHERE shift_id = $1 AND status IN ('paid','confirmed','completed')`,
      [shiftId],
    );
    const r = res.rows[0]!;
    return { cash: parseFloat(r.cash), nonCash: parseFloat(r.noncash), total: parseFloat(r.total), count: parseInt(r.count, 10) };
  }

  private async pettyTotals(shiftId: string): Promise<{ in: number; out: number }> {
    const res = await this.pool.query<{ tin: string; tout: string }>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE type='in'),0) AS tin,
              COALESCE(SUM(amount) FILTER (WHERE type='out'),0) AS tout
       FROM petty_cash_movements WHERE shift_id = $1`,
      [shiftId],
    );
    return { in: parseFloat(res.rows[0]!.tin), out: parseFloat(res.rows[0]!.tout) };
  }

  private async assertShift(tenantId: string, shiftId: string): Promise<void> {
    const r = await this.pool.query(`SELECT id FROM pos_shifts WHERE id = $1 AND tenant_id = $2`, [shiftId, tenantId]);
    if (r.rows.length === 0) throw new NotFoundException('Shift not found');
  }
  private async assertOpenShift(tenantId: string, shiftId: string): Promise<void> {
    const r = await this.pool.query(`SELECT status FROM pos_shifts WHERE id = $1 AND tenant_id = $2`, [shiftId, tenantId]);
    if (r.rows.length === 0) throw new NotFoundException('Shift not found');
    if (r.rows[0]!.status === 'closed') throw new BadRequestException('Shift is closed');
  }

  private mapShift(s: Record<string, any>): Record<string, unknown> {
    return {
      id: s.id,
      outletId: s.outlet_id,
      operatorId: s.operator_id,
      operatorName: s.operator_name,
      status: s.status,
      openingFloat: parseFloat(s.opening_float),
      closingCounted: s.closing_counted != null ? parseFloat(s.closing_counted) : null,
      expectedCash: s.expected_cash != null ? parseFloat(s.expected_cash) : null,
      variance: s.variance != null ? parseFloat(s.variance) : null,
      cashSales: s.cash_sales != null ? parseFloat(s.cash_sales) : null,
      nonCashSales: s.non_cash_sales != null ? parseFloat(s.non_cash_sales) : null,
      totalSales: s.total_sales != null ? parseFloat(s.total_sales) : null,
      orderCount: s.order_count,
      notes: s.notes,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
    };
  }
}
