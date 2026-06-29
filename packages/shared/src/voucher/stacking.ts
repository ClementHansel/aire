/**
 * Voucher stacking rules for the AIRE Operations Platform.
 *
 * Enforces maximum 1 voucher per type per transaction:
 * - Max 1 FIXED + 1 PERCENTAGE + 1 SERVICE_PACK = max 3 vouchers total
 *
 * Requirements: 17.2
 */

import { VoucherType } from '../enums';

export interface AppliedVoucher {
  code: string;
  type: VoucherType;
  discountValue: number;
}

export interface StackingResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Determines whether a new voucher can be stacked onto the current transaction.
 *
 * Rules:
 * - Maximum 1 voucher of each type per transaction
 * - If a voucher of the same type is already applied, the new one is rejected
 *
 * @param newVoucherType - The type of voucher being added
 * @param appliedVouchers - The list of vouchers already applied to the transaction
 * @returns StackingResult indicating whether stacking is allowed
 */
export function canStackVoucher(
  newVoucherType: VoucherType,
  appliedVouchers: AppliedVoucher[],
): StackingResult {
  const hasExistingOfSameType = appliedVouchers.some(
    (voucher) => voucher.type === newVoucherType,
  );

  if (hasExistingOfSameType) {
    const typeLabel = newVoucherType.toUpperCase();
    return {
      allowed: false,
      reason: `A ${typeLabel} voucher is already applied`,
    };
  }

  return { allowed: true };
}
