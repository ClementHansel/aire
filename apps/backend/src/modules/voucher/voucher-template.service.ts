import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { VoucherType, VALID_VOUCHER_TYPES, ERR_VOUCHER_PACK_NOT_FOUND } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { VoucherTemplate, VoucherTemplateRow, CreateVoucherTemplateDto } from './voucher.interfaces';

/**
 * Manages voucher templates — the sellable catalog of voucher packs.
 * A template defines the benefit (fixed/percentage/service_pack), the number
 * of uses per pack, the sale price, and validity.
 */
@Injectable()
export class VoucherTemplateService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** List active templates for a tenant (the Sell Pack catalog). */
  async listCatalog(tenantId: string): Promise<VoucherTemplate[]> {
    const res = await this.pool.query<VoucherTemplateRow>(
      `SELECT * FROM voucher_templates
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return res.rows.map((r) => this.map(r));
  }

  /** Get a single template by id within the tenant. */
  async getTemplate(tenantId: string, id: string): Promise<VoucherTemplateRow> {
    const res = await this.pool.query<VoucherTemplateRow>(
      `SELECT * FROM voucher_templates WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rows.length === 0) throw new NotFoundException(ERR_VOUCHER_PACK_NOT_FOUND);
    return res.rows[0]!;
  }

  /** Create a new voucher template. */
  async createTemplate(tenantId: string, dto: CreateVoucherTemplateDto): Promise<VoucherTemplate> {
    if (!dto.name?.trim()) throw new BadRequestException('Template name is required');
    if (!VALID_VOUCHER_TYPES.includes(dto.type)) {
      throw new BadRequestException(`Invalid voucher type. Must be one of: ${VALID_VOUCHER_TYPES.join(', ')}`);
    }
    if (dto.maxUses <= 0) throw new BadRequestException('maxUses must be greater than 0');
    if (dto.salePrice < 0) throw new BadRequestException('salePrice cannot be negative');
    if (dto.type === VoucherType.Percentage && (dto.value <= 0 || dto.value > 100)) {
      throw new BadRequestException('Percentage value must be between 1 and 100');
    }

    const res = await this.pool.query<VoucherTemplateRow>(
      `INSERT INTO voucher_templates
        (tenant_id, name, type, value, max_uses, sale_price, validity_days,
         service_ids, outlet_ids, brand_scope, min_order_amount, start_date, expiry_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       RETURNING *`,
      [
        tenantId,
        dto.name.trim(),
        dto.type,
        dto.value,
        dto.maxUses,
        dto.salePrice,
        dto.validityDays ?? null,
        dto.serviceIds ?? null,
        dto.outletIds ?? null,
        dto.brandScope ?? null,
        dto.minOrderAmount ?? 0,
        dto.startDate ?? null,
        dto.expiryDate ?? null,
      ],
    );
    return this.map(res.rows[0]!);
  }

  /** Update an existing voucher template. */
  async updateTemplate(
    tenantId: string,
    id: string,
    dto: Partial<CreateVoucherTemplateDto>,
  ): Promise<VoucherTemplate> {
    await this.getTemplate(tenantId, id); // 404 if not found

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const push = (col: string, val: unknown) => { sets.push(`${col} = $${i++}`); vals.push(val); };

    if (dto.name !== undefined) push('name', dto.name.trim());
    if (dto.type !== undefined) {
      if (!VALID_VOUCHER_TYPES.includes(dto.type)) {
        throw new BadRequestException(`Invalid voucher type. Must be one of: ${VALID_VOUCHER_TYPES.join(', ')}`);
      }
      push('type', dto.type);
    }
    if (dto.value !== undefined) push('value', dto.value);
    if (dto.maxUses !== undefined) {
      if (dto.maxUses <= 0) throw new BadRequestException('maxUses must be greater than 0');
      push('max_uses', dto.maxUses);
    }
    if (dto.salePrice !== undefined) {
      if (dto.salePrice < 0) throw new BadRequestException('salePrice cannot be negative');
      push('sale_price', dto.salePrice);
    }
    if (dto.validityDays !== undefined) push('validity_days', dto.validityDays);
    if (dto.serviceIds !== undefined) push('service_ids', dto.serviceIds);
    if (dto.outletIds !== undefined) push('outlet_ids', dto.outletIds);
    if (dto.brandScope !== undefined) push('brand_scope', dto.brandScope);
    if (dto.minOrderAmount !== undefined) push('min_order_amount', dto.minOrderAmount);
    if (dto.startDate !== undefined) push('start_date', dto.startDate);
    if (dto.expiryDate !== undefined) push('expiry_date', dto.expiryDate);

    if (sets.length === 0) return this.map(await this.getTemplate(tenantId, id));

    vals.push(id, tenantId);
    const res = await this.pool.query<VoucherTemplateRow>(
      `UPDATE voucher_templates SET ${sets.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i}
       RETURNING *`,
      vals,
    );
    return this.map(res.rows[0]!);
  }

  /** Soft-delete (deactivate) a voucher template. */
  async deactivateTemplate(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE voucher_templates SET is_active = false WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (res.rowCount === 0) throw new NotFoundException(ERR_VOUCHER_PACK_NOT_FOUND);
  }

  private map(r: VoucherTemplateRow): VoucherTemplate {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      value: parseFloat(r.value),
      maxUses: r.max_uses,
      salePrice: parseFloat(r.sale_price),
      validityDays: r.validity_days,
      serviceIds: r.service_ids,
      outletIds: r.outlet_ids,
      brandScope: r.brand_scope,
      minOrderAmount: parseFloat(r.min_order_amount),
      startDate: r.start_date,
      expiryDate: r.expiry_date,
      isActive: r.is_active,
    };
  }
}
