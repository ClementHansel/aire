import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { CampaignStatus } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { Campaign, CampaignRow, CreateCampaignDto, UpdateCampaignDto } from './campaign.interfaces';

const CAMPAIGN_STATUSES: CampaignStatus[] = ['active', 'paused', 'completed', 'expired'];

/**
 * CRUD for the "buy membership -> N bonus voucher codes" campaign system.
 * Owner-facing management; the actual grant-on-activation logic lives in
 * CampaignGrantService (subscribes to MembershipActivated).
 */
@Injectable()
export class CampaignService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** List campaigns for a tenant (newest first). */
  async list(tenantId: string): Promise<Campaign[]> {
    const res = await this.pool.query<CampaignRow>(
      'SELECT * FROM campaigns WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return res.rows.map(this.map);
  }

  /** Get a single campaign within the tenant. */
  async get(tenantId: string, id: string): Promise<Campaign> {
    const res = await this.pool.query<CampaignRow>(
      'SELECT * FROM campaigns WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Campaign not found');
    return this.map(res.rows[0]!);
  }

  /** Create a new campaign scoped to the tenant. */
  async create(tenantId: string, dto: CreateCampaignDto): Promise<Campaign> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    if (!dto.planId) throw new BadRequestException('planId is required');
    if (!dto.bonusTemplateId) throw new BadRequestException('bonusTemplateId is required');
    if (!dto.startDate || !dto.endDate) throw new BadRequestException('startDate and endDate are required');
    if (dto.startDate > dto.endDate) throw new BadRequestException('startDate must be before endDate');
    if (dto.cap !== undefined && dto.cap !== null && dto.cap < 0) {
      throw new BadRequestException('cap cannot be negative');
    }
    if (dto.perCustomerLimit !== undefined && dto.perCustomerLimit < 1) {
      throw new BadRequestException('perCustomerLimit must be at least 1');
    }
    if (dto.status && !CAMPAIGN_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`invalid status. Must be one of: ${CAMPAIGN_STATUSES.join(', ')}`);
    }

    const res = await this.pool.query<CampaignRow>(
      `INSERT INTO campaigns
        (tenant_id, name, plan_id, bonus_template_id, start_date, end_date, cap, per_customer_limit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        tenantId,
        dto.name.trim(),
        dto.planId,
        dto.bonusTemplateId,
        dto.startDate,
        dto.endDate,
        dto.cap ?? null,
        dto.perCustomerLimit ?? 1,
        dto.status ?? 'active',
      ],
    );
    return this.map(res.rows[0]!);
  }

  /** Update an existing campaign. */
  async update(tenantId: string, id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    if (dto.status && !CAMPAIGN_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`invalid status. Must be one of: ${CAMPAIGN_STATUSES.join(', ')}`);
    }
    if (dto.cap !== undefined && dto.cap !== null && dto.cap < 0) {
      throw new BadRequestException('cap cannot be negative');
    }
    if (dto.perCustomerLimit !== undefined && dto.perCustomerLimit < 1) {
      throw new BadRequestException('perCustomerLimit must be at least 1');
    }
    if (dto.startDate !== undefined && dto.endDate !== undefined && dto.startDate > dto.endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const set: string[] = [];
    const v: unknown[] = [];
    let i = 1;
    const c = (col: string, val: unknown) => { set.push(`${col} = $${i++}`); v.push(val); };
    if (dto.name !== undefined) c('name', dto.name.trim());
    if (dto.planId !== undefined) c('plan_id', dto.planId);
    if (dto.bonusTemplateId !== undefined) c('bonus_template_id', dto.bonusTemplateId);
    if (dto.startDate !== undefined) c('start_date', dto.startDate);
    if (dto.endDate !== undefined) c('end_date', dto.endDate);
    if (dto.cap !== undefined) c('cap', dto.cap);
    if (dto.perCustomerLimit !== undefined) c('per_customer_limit', dto.perCustomerLimit);
    if (dto.status !== undefined) c('status', dto.status);
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()');
    v.push(id, tenantId);

    const res = await this.pool.query<CampaignRow>(
      `UPDATE campaigns SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`,
      v,
    );
    if (res.rows.length === 0) throw new NotFoundException('Campaign not found');
    return this.map(res.rows[0]!);
  }

  /** Deactivate a campaign (status = 'paused'). Kept non-destructive: grants history stays intact. */
  async deactivate(tenantId: string, id: string): Promise<Campaign> {
    const res = await this.pool.query<CampaignRow>(
      `UPDATE campaigns SET status = 'paused', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException('Campaign not found');
    return this.map(res.rows[0]!);
  }

  private map = (r: CampaignRow): Campaign => ({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    planId: r.plan_id,
    bonusTemplateId: r.bonus_template_id,
    startDate: r.start_date,
    endDate: r.end_date,
    cap: r.cap,
    perCustomerLimit: r.per_customer_limit,
    grantsCount: r.grants_count,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}
