import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import {
  ERR_MEMBERSHIP_PLAN_NOT_FOUND,
  ERR_MEMBERSHIP_ONE_PLAN_PER_ORDER,
  ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED,
  ERR_MEMBERSHIP_NOT_FOUND,
  MembershipStatus,
  normalizePlate,
} from '@aire/shared';
import { SellMembershipDto, ActivateMembershipDto } from './dto';
import { Membership, MembershipRow, MembershipPlate, MembershipPlateRow } from './interfaces';

/**
 * Service handling membership sales (Sell Pack flow) and activation.
 *
 * Responsibilities:
 * - Create pending membership record from a plan purchase
 * - Enforce max 1 membership plan per order
 * - Activate membership: set start_date, register plates, snapshot plan terms
 * - Schedule expiry reminders at H-30, H-7, H-day
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
 */
@Injectable()
export class MembershipSellService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Creates a new membership record in 'pending' status.
   * Validates plan exists and enforces max 1 membership per order.
   *
   * On creation, snapshots plan terms (max_uses, daily_limit) from the plan.
   * start_date and end_date are set to the current date initially;
   * they will be finalized on activation.
   */
  async sellMembership(dto: SellMembershipDto): Promise<Membership> {
    // 1. Check max 1 membership plan per order
    const existingMembership = await this.pool.query(
      'SELECT id FROM memberships WHERE order_id = $1',
      [dto.orderId],
    );

    if (existingMembership.rows.length > 0) {
      throw new ConflictException(ERR_MEMBERSHIP_ONE_PLAN_PER_ORDER);
    }

    // 2. Get plan details to snapshot terms
    const planResult = await this.pool.query(
      'SELECT * FROM membership_plans WHERE id = $1 AND is_active = true',
      [dto.planId],
    );

    if (planResult.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_PLAN_NOT_FOUND);
    }

    const plan = planResult.rows[0];
    const today = new Date();
    const startDate = this.formatDate(today);
    const endDate = this.calculateEndDate(today, plan.duration_months);

    // 3. Insert membership with status = 'pending', snapshot plan terms
    const result = await this.pool.query<MembershipRow>(
      `INSERT INTO memberships
        (tenant_id, customer_id, plan_id, status, start_date, end_date, uses_count, max_uses, daily_limit, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        dto.tenantId,
        dto.customerId,
        dto.planId,
        MembershipStatus.Pending,
        startDate,
        endDate,
        0,
        plan.max_uses,
        plan.daily_limit,
        dto.orderId,
      ],
    );

    return this.mapRowToEntity(result.rows[0]!);
  }

  /**
   * Activates a pending membership after payment confirmation.
   *
   * - Sets start_date = current date
   * - Calculates end_date = start_date + plan duration_months
   * - Registers plates (up to plan's max_plates)
   * - Sets status = 'active'
   * - Schedules expiry reminders (H-30, H-7, H-day)
   */
  async activateMembership(
    membershipId: string,
    dto: ActivateMembershipDto,
  ): Promise<Membership> {
    // 1. Fetch the membership
    const membershipResult = await this.pool.query<MembershipRow>(
      'SELECT * FROM memberships WHERE id = $1',
      [membershipId],
    );

    if (membershipResult.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_NOT_FOUND);
    }

    const membership = membershipResult.rows[0]!;

    // 2. Get plan to know max_plates and duration
    const planResult = await this.pool.query(
      'SELECT max_plates, duration_months FROM membership_plans WHERE id = $1',
      [membership.plan_id],
    );

    if (planResult.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_PLAN_NOT_FOUND);
    }

    const plan = planResult.rows[0];

    // 3. Enforce max_plates limit
    if (dto.plates.length > plan.max_plates) {
      throw new BadRequestException(ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED);
    }

    // 4. Set activation date and calculate end date
    const today = new Date();
    const startDate = this.formatDate(today);
    const endDate = this.calculateEndDate(today, plan.duration_months);

    // 5. Update membership to active
    const updateResult = await this.pool.query<MembershipRow>(
      `UPDATE memberships
       SET status = $1, start_date = $2, end_date = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [MembershipStatus.Active, startDate, endDate, membershipId],
    );

    // 6. Register plates
    if (dto.plates.length > 0) {
      await this.registerPlates(membershipId, dto.plates);
    }

    // 7. Schedule expiry reminders (H-30, H-7, H-day)
    await this.scheduleExpiryReminders(membershipId, endDate);

    return this.mapRowToEntity(updateResult.rows[0]!);
  }

  /**
   * Registers license plates for a membership.
   */
  private async registerPlates(
    membershipId: string,
    plates: { plate: string; brand?: string; model?: string }[],
  ): Promise<MembershipPlate[]> {
    const results: MembershipPlate[] = [];

    for (const plateDto of plates) {
      const { normalized } = normalizePlate(plateDto.plate);
      const plateNormalized = normalized || plateDto.plate.toUpperCase().replace(/\s/g, '');

      const result = await this.pool.query<MembershipPlateRow>(
        `INSERT INTO membership_plates (membership_id, plate, plate_normalized, brand, model)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          membershipId,
          plateDto.plate,
          plateNormalized,
          plateDto.brand ?? null,
          plateDto.model ?? null,
        ],
      );

      results.push(this.mapPlateRowToEntity(result.rows[0]!));
    }

    return results;
  }

  /**
   * Schedules expiry reminder notifications at H-30, H-7, and H-day
   * relative to the membership end date.
   *
   * In a full implementation this would queue BullMQ delayed jobs.
   * For now we insert records into a notification_schedules concept
   * or delegate to the NotificationModule.
   */
  async scheduleExpiryReminders(
    _membershipId: string,
    endDate: string,
  ): Promise<{ reminderDates: string[] }> {
    const end = new Date(endDate);

    const h30 = new Date(end);
    h30.setDate(h30.getDate() - 30);

    const h7 = new Date(end);
    h7.setDate(h7.getDate() - 7);

    const hDay = new Date(end);

    const reminderDates = [
      this.formatDate(h30),
      this.formatDate(h7),
      this.formatDate(hDay),
    ];

    // In production, this would enqueue delayed jobs via BullMQ.
    // For now, we store the scheduled dates as metadata or emit events.
    // This is a placeholder that can be extended when NotificationModule is implemented.

    return { reminderDates };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Calculates end date by adding duration months to start date.
   */
  calculateEndDate(startDate: Date, durationMonths: number): string {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + durationMonths);
    return this.formatDate(end);
  }

  /**
   * Formats a Date to YYYY-MM-DD string.
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private mapRowToEntity(row: MembershipRow): Membership {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      customerId: row.customer_id,
      planId: row.plan_id,
      status: row.status as MembershipStatus,
      startDate: row.start_date,
      endDate: row.end_date,
      usesCount: row.uses_count,
      maxUses: row.max_uses,
      dailyLimit: row.daily_limit,
      orderId: row.order_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapPlateRowToEntity(row: MembershipPlateRow): MembershipPlate {
    return {
      id: row.id,
      membershipId: row.membership_id,
      plate: row.plate,
      plateNormalized: row.plate_normalized,
      brand: row.brand,
      model: row.model,
      createdAt: row.created_at,
    };
  }
}
