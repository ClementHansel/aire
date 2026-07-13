import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type BillingCycle = 'monthly' | 'annual';

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  billingCycle: BillingCycle;
  features: string[];
  limits: Record<string, number>;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformPlanDto {
  code: string;
  name: string;
  description?: string | null;
  price: number;
  billingCycle?: BillingCycle;
  features?: string[];
  limits?: Record<string, number>;
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdatePlatformPlanDto = Partial<Omit<CreatePlatformPlanDto, 'code'>> & { code?: string };

interface PlatformPlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  billing_cycle: BillingCycle;
  features: string[];
  limits: Record<string, number>;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * CRUD for the platform's SaaS subscription plans (what the platform charges
 * tenants). Distinct from MembershipPlanService (what tenants sell to their
 * customers). A tenant's assigned plan is `tenants.plan` matched to `code`.
 */
@Injectable()
export class PlatformPlanService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(includeInactive = true): Promise<PlatformPlan[]> {
    const where = includeInactive ? '' : 'WHERE is_active = true';
    const r = await this.pool.query<PlatformPlanRow>(
      `SELECT * FROM platform_plans ${where} ORDER BY sort_order, name`,
    );
    return r.rows.map((row) => this.map(row));
  }

  async create(dto: CreatePlatformPlanDto): Promise<PlatformPlan> {
    this.validate(dto);
    try {
      const r = await this.pool.query<PlatformPlanRow>(
        `INSERT INTO platform_plans
           (code, name, description, price, billing_cycle, features, limits, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          dto.code.trim(),
          dto.name.trim(),
          dto.description ?? null,
          dto.price,
          dto.billingCycle ?? 'monthly',
          JSON.stringify(dto.features ?? []),
          JSON.stringify(dto.limits ?? {}),
          dto.isActive ?? true,
          dto.sortOrder ?? 0,
        ],
      );
      return this.map(r.rows[0]!);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException('A plan with that code already exists');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdatePlatformPlanDto): Promise<PlatformPlan> {
    if (dto.billingCycle && !['monthly', 'annual'].includes(dto.billingCycle)) {
      throw new BadRequestException('Invalid billing cycle');
    }
    if (dto.price !== undefined && dto.price < 0) throw new BadRequestException('Price must be >= 0');

    const set: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const push = (col: string, v: unknown) => { set.push(`${col} = $${i++}`); vals.push(v); };
    if (dto.code !== undefined) push('code', dto.code.trim());
    if (dto.name !== undefined) push('name', dto.name.trim());
    if (dto.description !== undefined) push('description', dto.description);
    if (dto.price !== undefined) push('price', dto.price);
    if (dto.billingCycle !== undefined) push('billing_cycle', dto.billingCycle);
    if (dto.features !== undefined) push('features', JSON.stringify(dto.features));
    if (dto.limits !== undefined) push('limits', JSON.stringify(dto.limits));
    if (dto.isActive !== undefined) push('is_active', dto.isActive);
    if (dto.sortOrder !== undefined) push('sort_order', dto.sortOrder);
    if (set.length === 0) {
      const cur = await this.pool.query<PlatformPlanRow>('SELECT * FROM platform_plans WHERE id = $1', [id]);
      if (cur.rows.length === 0) throw new NotFoundException('Plan not found');
      return this.map(cur.rows[0]!);
    }
    set.push('updated_at = NOW()');
    vals.push(id);
    try {
      const r = await this.pool.query<PlatformPlanRow>(
        `UPDATE platform_plans SET ${set.join(', ')} WHERE id = $${i} RETURNING *`,
        vals,
      );
      if (r.rows.length === 0) throw new NotFoundException('Plan not found');
      return this.map(r.rows[0]!);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException('A plan with that code already exists');
      }
      throw e;
    }
  }

  /** Soft delete — deactivate rather than drop, so tenants on this plan keep resolving. */
  async remove(id: string): Promise<void> {
    const r = await this.pool.query('UPDATE platform_plans SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
    if (r.rowCount === 0) throw new NotFoundException('Plan not found');
  }

  /** code -> monthly-equivalent price, for MRR math (annual plans divided by 12). */
  async monthlyPriceByCode(): Promise<Map<string, number>> {
    const rows = await this.list();
    return new Map(rows.map((p) => [p.code, p.billingCycle === 'annual' ? p.price / 12 : p.price]));
  }

  private validate(dto: CreatePlatformPlanDto): void {
    if (!dto.code || !/^[a-z0-9][a-z0-9_-]*$/i.test(dto.code.trim())) {
      throw new BadRequestException('Code must be alphanumeric (dashes/underscores allowed)');
    }
    if (!dto.name || dto.name.trim().length === 0) throw new BadRequestException('Name is required');
    if (dto.price < 0) throw new BadRequestException('Price must be >= 0');
    if (dto.billingCycle && !['monthly', 'annual'].includes(dto.billingCycle)) {
      throw new BadRequestException('Invalid billing cycle');
    }
  }

  private map(row: PlatformPlanRow): PlatformPlan {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      billingCycle: row.billing_cycle,
      features: Array.isArray(row.features) ? row.features : [],
      limits: row.limits && typeof row.limits === 'object' ? row.limits : {},
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
