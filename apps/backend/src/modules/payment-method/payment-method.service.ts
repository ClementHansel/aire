import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { KIND_RANK, seedDefaultPaymentMethods } from './payment-method.defaults';

export type PaymentKind = 'cash' | 'qris' | 'edc' | 'cc' | 'transfer';

export interface PaymentMethodRecord {
  id: string;
  tenantId: string;
  outletId: string | null;
  name: string;
  kind: PaymentKind;
  businessUnit: string | null;
  logoUrl: string | null;
  color: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpsertPaymentMethodDto {
  outletId?: string | null;
  name: string;
  kind: PaymentKind;
  businessUnit?: string | null;
  logoUrl?: string | null;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

const VALID_KINDS: PaymentKind[] = ['cash', 'qris', 'edc', 'cc', 'transfer'];

/**
 * Per-branch payment methods (CRUD from the dashboard). Each method carries a
 * logo + colour so the POS shows recognisable buttons (e.g. EDC BRI orange).
 */
@Injectable()
export class PaymentMethodService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** List methods for a tenant; if outletId given, returns that branch's + tenant-wide (null) methods. */
  async findAll(tenantId: string, outletId?: string, activeOnly = false): Promise<PaymentMethodRecord[]> {
    const conditions = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    if (outletId) {
      conditions.push(`(outlet_id = $${values.length + 1} OR outlet_id IS NULL)`);
      values.push(outletId);
    }
    if (activeOnly) conditions.push('is_active = true');
    const res = await this.pool.query(
      `SELECT * FROM payment_methods WHERE ${conditions.join(' AND ')}
       ORDER BY sort_order, name`,
      values,
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async create(tenantId: string, dto: UpsertPaymentMethodDto): Promise<PaymentMethodRecord> {
    if (!VALID_KINDS.includes(dto.kind)) {
      throw new BadRequestException(`Invalid kind. Must be one of: ${VALID_KINDS.join(', ')}`);
    }
    const res = await this.pool.query(
      `INSERT INTO payment_methods (tenant_id, outlet_id, name, kind, business_unit, logo_url, color, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        tenantId,
        dto.outletId ?? null,
        dto.name,
        dto.kind,
        dto.businessUnit ?? null,
        dto.logoUrl ?? null,
        dto.color ?? '#1652F0',
        // Placement is fixed by payment kind so POS buttons stay predictable,
        // unless the caller explicitly overrides the order.
        dto.sortOrder ?? KIND_RANK[dto.kind] ?? 0,
        dto.isActive ?? true,
      ],
    );
    return this.mapRow(res.rows[0]);
  }

  /**
   * Seed the default starter set for a tenant that has none yet. Idempotent:
   * does nothing if the tenant already has any payment method. Returns the
   * resulting list so the caller can render immediately.
   */
  async seedDefaults(tenantId: string): Promise<PaymentMethodRecord[]> {
    await seedDefaultPaymentMethods(this.pool, tenantId);
    return this.findAll(tenantId);
  }

  async update(tenantId: string, id: string, dto: Partial<UpsertPaymentMethodDto>): Promise<PaymentMethodRecord> {
    if (dto.kind && !VALID_KINDS.includes(dto.kind)) {
      throw new BadRequestException(`Invalid kind. Must be one of: ${VALID_KINDS.join(', ')}`);
    }
    const set: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const col = (c: string, v: unknown) => { set.push(`${c} = $${i}`); values.push(v); i++; };
    if (dto.outletId !== undefined) col('outlet_id', dto.outletId);
    if (dto.name !== undefined) col('name', dto.name);
    if (dto.kind !== undefined) col('kind', dto.kind);
    if (dto.businessUnit !== undefined) col('business_unit', dto.businessUnit);
    if (dto.logoUrl !== undefined) col('logo_url', dto.logoUrl);
    if (dto.color !== undefined) col('color', dto.color);
    if (dto.sortOrder !== undefined) col('sort_order', dto.sortOrder);
    if (dto.isActive !== undefined) col('is_active', dto.isActive);
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()');
    values.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE payment_methods SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} RETURNING *`,
      values,
    );
    if (res.rows.length === 0) throw new NotFoundException('Payment method not found');
    return this.mapRow(res.rows[0]);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query('DELETE FROM payment_methods WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Payment method not found');
  }

  private mapRow(r: any): PaymentMethodRecord {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      outletId: r.outlet_id ?? null,
      name: r.name,
      kind: r.kind,
      businessUnit: r.business_unit ?? null,
      logoUrl: r.logo_url ?? null,
      color: r.color ?? '#1652F0',
      sortOrder: r.sort_order ?? 0,
      isActive: r.is_active,
    };
  }
}
