import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { ERR_MEMBERSHIP_PLAN_NOT_FOUND, ERR_VALIDATION_FAILED } from '@aire/shared';
import { CreateMembershipPlanDto, UpdateMembershipPlanDto } from './dto';
import { MembershipPlan, MembershipPlanRow } from './interfaces';

const ALLOWED_DURATIONS = [1, 3, 12];

@Injectable()
export class MembershipPlanService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Create a new membership plan for a tenant.
   */
  async createPlan(
    tenantId: string,
    dto: CreateMembershipPlanDto,
  ): Promise<MembershipPlan> {
    this.validateCreateDto(dto);

    const result = await this.pool.query<MembershipPlanRow>(
      `INSERT INTO membership_plans
        (tenant_id, name, duration_months, max_uses, daily_limit, max_plates, price, outlet_ids, free_service_ids, discounted_services, whatsapp_welcome_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        dto.name,
        dto.durationMonths,
        dto.maxUses,
        dto.dailyLimit ?? 1,
        dto.maxPlates ?? 3,
        dto.price,
        dto.outletIds ?? null,
        dto.freeServiceIds ?? null,
        JSON.stringify(dto.discountedServices ?? []),
        dto.whatsappWelcomeEnabled ?? false,
      ],
    );

    return this.mapRowToEntity(result.rows[0]!);
  }

  /**
   * Update an existing plan. Changes only affect NEW memberships —
   * existing active memberships snapshot plan terms at activation time.
   */
  async updatePlan(
    planId: string,
    dto: UpdateMembershipPlanDto,
  ): Promise<MembershipPlan> {
    if (dto.durationMonths !== undefined && !ALLOWED_DURATIONS.includes(dto.durationMonths)) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (dto.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(dto.name);
    }
    if (dto.durationMonths !== undefined) {
      fields.push(`duration_months = $${paramIndex++}`);
      values.push(dto.durationMonths);
    }
    if (dto.maxUses !== undefined) {
      fields.push(`max_uses = $${paramIndex++}`);
      values.push(dto.maxUses);
    }
    if (dto.dailyLimit !== undefined) {
      fields.push(`daily_limit = $${paramIndex++}`);
      values.push(dto.dailyLimit);
    }
    if (dto.maxPlates !== undefined) {
      fields.push(`max_plates = $${paramIndex++}`);
      values.push(dto.maxPlates);
    }
    if (dto.price !== undefined) {
      fields.push(`price = $${paramIndex++}`);
      values.push(dto.price);
    }
    if (dto.outletIds !== undefined) {
      fields.push(`outlet_ids = $${paramIndex++}`);
      values.push(dto.outletIds);
    }
    if (dto.freeServiceIds !== undefined) {
      fields.push(`free_service_ids = $${paramIndex++}`);
      values.push(dto.freeServiceIds);
    }
    if (dto.discountedServices !== undefined) {
      fields.push(`discounted_services = $${paramIndex++}`);
      values.push(JSON.stringify(dto.discountedServices));
    }
    if (dto.whatsappWelcomeEnabled !== undefined) {
      fields.push(`whatsapp_welcome_enabled = $${paramIndex++}`);
      values.push(dto.whatsappWelcomeEnabled);
    }

    if (fields.length === 0) {
      // No fields to update — just return current plan
      return this.getPlan(planId);
    }

    values.push(planId);
    const query = `UPDATE membership_plans SET ${fields.join(', ')} WHERE id = $${paramIndex} AND is_active = true RETURNING *`;

    const result = await this.pool.query<MembershipPlanRow>(query, values);

    if (result.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_PLAN_NOT_FOUND);
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  /**
   * Get a single plan by ID.
   */
  async getPlan(planId: string): Promise<MembershipPlan> {
    const result = await this.pool.query<MembershipPlanRow>(
      'SELECT * FROM membership_plans WHERE id = $1 AND is_active = true',
      [planId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_PLAN_NOT_FOUND);
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  /**
   * List plans for a tenant, optionally filtered by outlet scope.
   * If outletId is provided, returns plans that apply to all outlets (outlet_ids IS NULL)
   * OR plans that include the specified outlet in their outlet_ids array.
   */
  async listPlans(tenantId: string, outletId?: string): Promise<MembershipPlan[]> {
    let query: string;
    let params: unknown[];

    if (outletId) {
      query = `SELECT * FROM membership_plans
               WHERE tenant_id = $1 AND is_active = true
               AND (outlet_ids IS NULL OR $2 = ANY(outlet_ids))
               ORDER BY created_at DESC`;
      params = [tenantId, outletId];
    } else {
      query = `SELECT * FROM membership_plans
               WHERE tenant_id = $1 AND is_active = true
               ORDER BY created_at DESC`;
      params = [tenantId];
    }

    const result = await this.pool.query<MembershipPlanRow>(query, params);
    return result.rows.map((row) => this.mapRowToEntity(row));
  }

  /**
   * Soft delete a plan (set is_active = false).
   * Existing memberships referencing this plan are unaffected.
   */
  async deletePlan(planId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE membership_plans SET is_active = false WHERE id = $1 AND is_active = true',
      [planId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException(ERR_MEMBERSHIP_PLAN_NOT_FOUND);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private validateCreateDto(dto: CreateMembershipPlanDto): void {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }
    if (!ALLOWED_DURATIONS.includes(dto.durationMonths)) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }
    if (dto.maxUses <= 0) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }
    if (dto.price < 0) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }
    if (dto.dailyLimit !== undefined && dto.dailyLimit <= 0) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }
    if (dto.maxPlates !== undefined && dto.maxPlates <= 0) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }
  }

  private mapRowToEntity(row: MembershipPlanRow): MembershipPlan {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      durationMonths: row.duration_months,
      maxUses: row.max_uses,
      dailyLimit: row.daily_limit,
      maxPlates: row.max_plates,
      price: parseFloat(row.price),
      outletIds: row.outlet_ids,
      freeServiceIds: row.free_service_ids,
      discountedServices: row.discounted_services ?? [],
      whatsappWelcomeEnabled: row.whatsapp_welcome_enabled,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
