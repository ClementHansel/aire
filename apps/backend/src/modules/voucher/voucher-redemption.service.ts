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

    // Hashed pack code first (the legacy model), then the plaintext ticket model.
    // Both must be accepted here: shareable BOOK codes are what campaign bonuses
    // have issued since migration 086 and what pack purchases issue since
    // AIRIN-145, and this endpoint only ever hashed the input and searched
    // voucher_codes — so every book code came back "not found" and a cashier
    // could not apply a voucher the customer had legitimately bought or been
    // granted (AIRIN-149). The order pipeline already redeemed both models, so
    // validation was the only step out of step.
    const data = (await this.lookup(tenantId, codeHash))
      ?? (await this.lookupTicket(tenantId, code));
    const state = evaluateVoucher(data, context);

    if (state.status === 'valid_applicable') {
      const discountAmount = this.computeDiscount(state.type, state.discountValue, context.orderSubtotal);
      return {
        status: state.status,
        type: state.type,
        discountValue: state.discountValue,
        discountAmount,
        // Which service a free-service code covers. Its money value is 0 above
        // (the order pipeline prices it against the covered line), so the POS
        // needs the service id to reflect the code in its running total.
        benefitServiceIds: data?.serviceIds ?? undefined,
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

  /**
   * Look up a shareable BOOK ticket by its plaintext code and present it as
   * VoucherData, so one evaluateVoucher() rule set covers both voucher models.
   *
   * The benefit is read off the book, which is the only place a book's worth is
   * recorded. Two deliberate choices keep this in step with what the order
   * pipeline (resolveDigitalVouchers) actually does at checkout, rather than
   * inventing stricter rules that would let validation pass and the order fail,
   * or vice versa:
   *   - `outletIds: null` — a ticket is shareable and redeemable at any branch of
   *     the tenant; the order path applies no branch filter either.
   *   - `serviceIds` — only a service-typed benefit is tied to one service; a
   *     fixed/percentage book applies to the whole cart.
   */
  private async lookupTicket(tenantId: string, code: string): Promise<VoucherData | null> {
    const res = await this.pool.query<{
      ticket_status: string;
      ticket_expiry: string | null;
      benefit_type: string;
      benefit_value: string;
      benefit_service_id: string | null;
    }>(
      `SELECT t.status AS ticket_status, COALESCE(t.expiry_date, b.expiry_date) AS ticket_expiry,
              b.benefit_type, b.benefit_value::text AS benefit_value, b.benefit_service_id
         FROM voucher_tickets t
         JOIN voucher_books b ON b.id = t.book_id
        WHERE t.tenant_id = $1 AND t.code = $2`,
      [tenantId, code.trim().toUpperCase()],
    );
    const row = res.rows[0];
    if (!row) return null;

    // 'service' is the book model's spelling of a free service, which the voucher
    // vocabulary calls 'service_pack'.
    const type = (row.benefit_type === 'service' ? VoucherType.ServicePack : row.benefit_type) as VoucherType;

    return {
      type,
      value: parseFloat(row.benefit_value),
      maxUses: 1, // every ticket is single-use
      currentUses: row.ticket_status === 'active' ? 0 : 1,
      startDate: null, // books carry no start date — valid from issue
      expiryDate: row.ticket_expiry,
      outletIds: null,
      brandScope: null,
      serviceIds: row.benefit_service_id ? [row.benefit_service_id] : null,
      minOrderAmount: 0,
      isActive: row.ticket_status === 'active',
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
