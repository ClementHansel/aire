/**
 * Golden Rule: When both voucher and membership apply to the same service,
 * the voucher discount wins and membership quota is NOT consumed.
 *
 * Requirements: 17.5
 */

export interface CartItemWithBenefits {
  serviceId: string;
  unitPrice: number;
  quantity: number;
  hasMembershipBenefit: boolean; // true if membership covers this service
  hasVoucherBenefit: boolean; // true if a voucher applies to this service
  membershipDiscountAmount: number; // what membership would discount
  voucherDiscountAmount: number; // what voucher would discount
}

export interface GoldenRuleResult {
  serviceId: string;
  appliedDiscount: 'voucher' | 'membership' | 'none';
  discountAmount: number;
  consumeMembershipQuota: boolean; // false when voucher wins
}

/**
 * Applies the Golden Rule: when both voucher and membership apply to the same
 * service, the voucher wins and membership quota is NOT consumed.
 *
 * Logic per item:
 * - If hasVoucherBenefit AND hasMembershipBenefit → voucher wins, consumeMembershipQuota = false
 * - If only hasMembershipBenefit → membership applies, consumeMembershipQuota = true
 * - If only hasVoucherBenefit → voucher applies, consumeMembershipQuota = false
 * - If neither → no discount, consumeMembershipQuota = false
 */
export function applyGoldenRule(items: CartItemWithBenefits[]): GoldenRuleResult[] {
  return items.map((item) => {
    if (item.hasVoucherBenefit && item.hasMembershipBenefit) {
      // Golden Rule: voucher wins, do NOT consume membership quota
      return {
        serviceId: item.serviceId,
        appliedDiscount: 'voucher' as const,
        discountAmount: item.voucherDiscountAmount,
        consumeMembershipQuota: false,
      };
    }

    if (item.hasMembershipBenefit && !item.hasVoucherBenefit) {
      // Only membership applies
      return {
        serviceId: item.serviceId,
        appliedDiscount: 'membership' as const,
        discountAmount: item.membershipDiscountAmount,
        consumeMembershipQuota: true,
      };
    }

    if (item.hasVoucherBenefit && !item.hasMembershipBenefit) {
      // Only voucher applies
      return {
        serviceId: item.serviceId,
        appliedDiscount: 'voucher' as const,
        discountAmount: item.voucherDiscountAmount,
        consumeMembershipQuota: false,
      };
    }

    // Neither applies
    return {
      serviceId: item.serviceId,
      appliedDiscount: 'none' as const,
      discountAmount: 0,
      consumeMembershipQuota: false,
    };
  });
}
