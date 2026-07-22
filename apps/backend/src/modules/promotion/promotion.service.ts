import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type RewardType = 'discount_fixed' | 'discount_percentage' | 'free_product' | 'free_voucher' | 'future_discount';
const REWARD_TYPES: RewardType[] = ['discount_fixed', 'discount_percentage', 'free_product', 'free_voucher', 'future_discount'];

export interface PromotionRecord {
  id: string; name: string; description: string | null; startDate: string; endDate: string;
  isActive: boolean; outletIds: string[] | null; triggerServiceIds: string[] | null;
  rewardType: RewardType; rewardValue: number; rewardServiceId: string | null;
  maxQuota: number | null; usedQuota: number;
  memberOnly: boolean; stackable: boolean; minPurchase: number;
}

export interface UpsertPromotionDto {
  name: string; description?: string; startDate: string; endDate: string; isActive?: boolean;
  outletIds?: string[] | null; triggerServiceIds?: string[] | null;
  rewardType: RewardType; rewardValue?: number; rewardServiceId?: string | null; maxQuota?: number | null;
  memberOnly?: boolean; stackable?: boolean; minPurchase?: number;
}

@Injectable()
export class PromotionService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(tenantId: string): Promise<PromotionRecord[]> {
    const res = await this.pool.query('SELECT * FROM promotions WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
    return res.rows.map(this.map);
  }

  async create(tenantId: string, dto: UpsertPromotionDto): Promise<PromotionRecord> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    if (!REWARD_TYPES.includes(dto.rewardType)) throw new BadRequestException('invalid rewardType');
    if (!dto.startDate || !dto.endDate) throw new BadRequestException('startDate and endDate are required');
    const res = await this.pool.query(
      `INSERT INTO promotions (tenant_id, name, description, start_date, end_date, is_active, outlet_ids, trigger_service_ids, reward_type, reward_value, reward_service_id, max_quota, member_only, stackable, min_purchase)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        tenantId, dto.name.trim(), dto.description ?? null, dto.startDate, dto.endDate, dto.isActive ?? true,
        dto.outletIds && dto.outletIds.length ? dto.outletIds : null,
        dto.triggerServiceIds && dto.triggerServiceIds.length ? dto.triggerServiceIds : null,
        dto.rewardType, dto.rewardValue ?? 0, dto.rewardServiceId ?? null, dto.maxQuota ?? null,
        dto.memberOnly ?? false, dto.stackable ?? false, dto.minPurchase ?? 0,
      ],
    );
    return this.map(res.rows[0]);
  }

  async update(tenantId: string, id: string, dto: Partial<UpsertPromotionDto>): Promise<PromotionRecord> {
    if (dto.rewardType && !REWARD_TYPES.includes(dto.rewardType)) throw new BadRequestException('invalid rewardType');
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    const c = (col: string, val: unknown) => { set.push(`${col} = $${i++}`); v.push(val); };
    if (dto.name !== undefined) c('name', dto.name);
    if (dto.description !== undefined) c('description', dto.description);
    if (dto.startDate !== undefined) c('start_date', dto.startDate);
    if (dto.endDate !== undefined) c('end_date', dto.endDate);
    if (dto.isActive !== undefined) c('is_active', dto.isActive);
    if (dto.outletIds !== undefined) c('outlet_ids', dto.outletIds && dto.outletIds.length ? dto.outletIds : null);
    if (dto.triggerServiceIds !== undefined) c('trigger_service_ids', dto.triggerServiceIds && dto.triggerServiceIds.length ? dto.triggerServiceIds : null);
    if (dto.rewardType !== undefined) c('reward_type', dto.rewardType);
    if (dto.rewardValue !== undefined) c('reward_value', dto.rewardValue);
    if (dto.rewardServiceId !== undefined) c('reward_service_id', dto.rewardServiceId);
    if (dto.maxQuota !== undefined) c('max_quota', dto.maxQuota);
    if (dto.memberOnly !== undefined) c('member_only', dto.memberOnly);
    if (dto.stackable !== undefined) c('stackable', dto.stackable);
    if (dto.minPurchase !== undefined) c('min_purchase', dto.minPurchase);
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()'); v.push(id, tenantId);
    const res = await this.pool.query(`UPDATE promotions SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`, v);
    if (res.rows.length === 0) throw new NotFoundException('Promotion not found');
    return this.map(res.rows[0]);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query('DELETE FROM promotions WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Promotion not found');
  }

  private map = (r: any): PromotionRecord => ({
    id: r.id, name: r.name, description: r.description ?? null,
    startDate: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date,
    endDate: r.end_date instanceof Date ? r.end_date.toISOString().slice(0, 10) : r.end_date,
    isActive: r.is_active, outletIds: r.outlet_ids ?? null, triggerServiceIds: r.trigger_service_ids ?? null,
    rewardType: r.reward_type, rewardValue: parseFloat(r.reward_value), rewardServiceId: r.reward_service_id ?? null,
    maxQuota: r.max_quota ?? null, usedQuota: r.used_quota ?? 0,
    memberOnly: r.member_only ?? false, stackable: r.stackable ?? false, minPurchase: parseFloat(r.min_purchase ?? '0'),
  });
}
