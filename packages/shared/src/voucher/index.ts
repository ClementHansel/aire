/**
 * Voucher condition evaluation logic for the AIRE Operations Platform.
 *
 * Evaluates voucher validity and applicability against the current order context.
 * Returns mutually exclusive states: valid+applicable (blue badge),
 * valid+not-applicable (orange badge + warning), or error states.
 *
 * Requirements: 17.1, 17.3, 17.4, 17.6, 17.7, 17.8, 17.9, 17.10
 */

import { VoucherType } from '../enums';

// Re-export code generator module
export {
  generateCode,
  hashVoucherCode,
  generateVoucherPack,
  type CodeGeneratorOptions,
  type GeneratedVoucherPack,
} from './code-generator';

/**
 * Represents the voucher data as stored/retrieved from the database.
 */
export interface VoucherData {
  type: VoucherType;
  value: number; // discount amount/percentage
  maxUses: number;
  currentUses: number;
  startDate: string | null; // ISO date
  expiryDate: string | null; // ISO date
  outletIds: string[] | null; // null = all outlets
  brandScope: string[] | null; // null = all brands
  serviceIds: string[] | null; // null = all services
  minOrderAmount: number;
  isActive: boolean;
  isParentCode: boolean; // true if this is a pack parent code
}

/**
 * Context for evaluating voucher conditions against the current order.
 */
export interface VoucherEvaluationContext {
  outletId: string;
  vehicleBrand?: string;
  serviceIdsInCart: string[];
  orderSubtotal: number;
  currentDate: string; // ISO date for comparison (YYYY-MM-DD)
}

/**
 * Mutually exclusive voucher evaluation states.
 * States are checked in priority order — the first applicable state is returned.
 */
export type VoucherState =
  | { status: 'valid_applicable'; type: VoucherType; discountValue: number }
  | { status: 'valid_not_applicable'; type: VoucherType; discountValue: number; reason: string }
  | { status: 'not_found' }
  | { status: 'fully_redeemed' }
  | { status: 'expired' }
  | { status: 'not_yet_active'; startDate: string }
  | { status: 'parent_code' }
  | { status: 'inactive' };

/**
 * Evaluates voucher validity and applicability against the given context.
 *
 * Check order (mutually exclusive — returns first match):
 * 1. null voucher → not_found
 * 2. isParentCode → parent_code
 * 3. !isActive → inactive
 * 4. currentUses >= maxUses → fully_redeemed
 * 5. expiryDate < currentDate → expired
 * 6. startDate > currentDate → not_yet_active
 * 7. Condition checks (valid but not applicable):
 *    - outlet mismatch
 *    - brand mismatch
 *    - service mismatch
 *    - min order not met
 * 8. All conditions met → valid_applicable
 */
export function evaluateVoucher(
  voucher: VoucherData | null,
  context: VoucherEvaluationContext,
): VoucherState {
  // 1. Null voucher → not found
  if (voucher === null) {
    return { status: 'not_found' };
  }

  // 2. Parent code → reject with specific message
  if (voucher.isParentCode) {
    return { status: 'parent_code' };
  }

  // 3. Inactive voucher → treated as not found equivalent
  if (!voucher.isActive) {
    return { status: 'inactive' };
  }

  // 4. Fully redeemed
  if (voucher.currentUses >= voucher.maxUses) {
    return { status: 'fully_redeemed' };
  }

  // 5. Expired
  if (voucher.expiryDate !== null && voucher.expiryDate < context.currentDate) {
    return { status: 'expired' };
  }

  // 6. Not yet active
  if (voucher.startDate !== null && voucher.startDate > context.currentDate) {
    return { status: 'not_yet_active', startDate: voucher.startDate };
  }

  // 7. Condition checks — voucher is valid but may not be applicable
  // 7a. Outlet scope mismatch
  if (voucher.outletIds !== null && !voucher.outletIds.includes(context.outletId)) {
    return {
      status: 'valid_not_applicable',
      type: voucher.type,
      discountValue: voucher.value,
      reason: 'Voucher is not valid for this outlet',
    };
  }

  // 7b. Brand scope mismatch
  if (voucher.brandScope !== null) {
    const brand = context.vehicleBrand;
    if (!brand || !voucher.brandScope.includes(brand)) {
      return {
        status: 'valid_not_applicable',
        type: voucher.type,
        discountValue: voucher.value,
        reason: 'Voucher is not valid for this vehicle brand',
      };
    }
  }

  // 7c. Service scope mismatch — none of the cart services match voucher services
  if (voucher.serviceIds !== null) {
    const hasMatchingService = context.serviceIdsInCart.some((id) =>
      voucher.serviceIds!.includes(id),
    );
    if (!hasMatchingService) {
      return {
        status: 'valid_not_applicable',
        type: voucher.type,
        discountValue: voucher.value,
        reason: 'Voucher is not valid for the services in cart',
      };
    }
  }

  // 7d. Minimum order amount not met
  if (voucher.minOrderAmount > 0 && context.orderSubtotal < voucher.minOrderAmount) {
    return {
      status: 'valid_not_applicable',
      type: voucher.type,
      discountValue: voucher.value,
      reason: `Minimum order amount of ${voucher.minOrderAmount} not met`,
    };
  }

  // 8. All conditions met → valid and applicable
  return {
    status: 'valid_applicable',
    type: voucher.type,
    discountValue: voucher.value,
  };
}
