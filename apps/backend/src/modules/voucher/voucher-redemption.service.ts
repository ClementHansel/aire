import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import {
  VoucherType,
  VoucherData,
  VoucherEvaluationContext,
  evaluateVoucher,
  hashVoucherCode,
} from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { ValidateVoucherResult } from './voucher.interfaces';

interface VoucherLookupRow {
  code_id: string;
  code_status: string;
  pack_status: string;
  pack_expiry: string | null;
  type: VoucherType;
  value: string;
  template_start: string | null;
  template_expiry: string | null;
  outlet_ids: string[] | null;
  brand_scope: string[] | null;
  service_ids: string[] | null;
  min_order_amount: string;
  template_active: boolean;
}

/**
 * Validates voucher child codes at the POS.
 *
 * Validation uses the shared evaluateVoucher() so the POS, order pipeline,
 * and tests all share one rule set. (Order-time discount + single-use
 * redemption is applied atomically inside OrderService.createOrder.)
 *
 * Requirements: 17.1, 17.3, 17.4, 17.6, 17.7, 17.8, 17.9, 17.10
 */
@Injectable()
export class VoucherRedemptionService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Validate a code against the current cart context and return its state plus
   * a computed discount for fixed/percentage vouchers.
   */
  async validate(
    tenantId: string,
    code: string,
    context: VoucherEvaluationContext,
  ): Promise<ValidateVoucherResult> {
    const codeHash = hashVoucherCode(code.trim());

    // Parent code? Reject with the specific message (Requirement 17.6).
    const parent = await this.pool.query(
      'SELECT id FROM voucher_packs WHERE parent_code_hash = $1 AND tenant_id = $2',
      [codeHash, tenantId],
    );
    if (parent.rows.length > 0) {
      return { status: 'parent_code', message: 'This is a voucher pack — present one of its individual codes' };
    }

    const data = await this.lookup(tenantId, codeHash);
    const state = evaluateVoucher(data, context);

    if (state.status === 'valid_applicable') {
      const discountAmount = this.computeDiscount(state.type, state.discountValue, context.orderSubtotal);
      return {
        status: state.status,
        type: state.type,
        discountValue: state.discountValue,
        discountAmount,
        message: 'Voucher applied',
      };
    }
    if (state.status === 'valid_not_applicable') {
      return {
        status: state.status,
        type: state.type,
        discountValue: state.discountValue,
        discountAmount: 0,
        reason: state.reason,
        message: state.reason,
      };
    }
    return { status: state.status, message: this.stateMessage(state) };
  }

  /** Look up a child code and assemble VoucherData; null if not found. */
  private async lookup(tenantId: string, codeHash: string): Promise<VoucherData | null> {
    const res = await this.pool.query<VoucherLookupRow>(
      `SELECT vc.id AS code_id, vc.status AS code_status,
              vp.status AS pack_status, vp.expiry_date AS pack_expiry,
              vt.type, vt.value::text AS value,
              vt.start_date AS template_start, vt.expiry_date AS template_expiry,
              vt.outlet_ids, vt.brand_scope, vt.service_ids,
              vt.min_order_amount::text AS min_order_amount, vt.is_active AS template_active
       FROM voucher_codes vc
       JOIN voucher_packs vp ON vp.id = vc.pack_id
       JOIN voucher_templates vt ON vt.id = vp.template_id
       WHERE vc.code_hash = $1 AND vp.tenant_id = $2`,
      [codeHash, tenantId],
    );
    const row = res.rows[0];
    if (!row) return null;

    return {
      type: row.type,
      value: parseFloat(row.value),
      maxUses: 1, // each child code is single-use
      currentUses: row.code_status === 'active' ? 0 : 1,
      startDate: row.template_start,
      expiryDate: row.pack_expiry ?? row.template_expiry,
      outletIds: row.outlet_ids,
      brandScope: row.brand_scope,
      serviceIds: row.service_ids,
      minOrderAmount: parseFloat(row.min_order_amount),
      isActive: row.template_active && row.pack_status === 'active' && row.code_status === 'active',
      isParentCode: false,
    };
  }

  /** Compute discount for fixed/percentage against a base amount. */
  private computeDiscount(type: VoucherType, value: number, baseAmount: number): number {
    if (type === VoucherType.Fixed) return Math.min(value, baseAmount);
    if (type === VoucherType.Percentage) return Math.round((baseAmount * value) / 100);
    // service_pack: amount is resolved by the order pipeline against covered items.
    return 0;
  }

  private stateMessage(state: { status: string; startDate?: string }): string {
    switch (state.status) {
      case 'not_found':
        return 'Voucher not found or not active';
      case 'inactive':
        return 'Voucher not found or not active';
      case 'fully_redeemed':
        return 'Voucher fully redeemed';
      case 'expired':
        return 'Voucher has expired';
      case 'not_yet_active':
        return `Voucher belum aktif (berlaku mulai ${state.startDate})`;
      case 'parent_code':
        return 'This is a voucher pack — present one of its individual codes';
      default:
        return 'Voucher cannot be applied';
    }
  }
}
