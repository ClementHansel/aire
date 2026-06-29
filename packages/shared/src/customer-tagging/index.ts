/**
 * Customer type tagging algorithm for the AIRE Operations Platform.
 *
 * Auto-assigns customer type tags on order confirmation based on order content.
 * Tags are assigned without manual Cashier input and support multiple tags
 * when multiple conditions apply simultaneously.
 *
 * Priority (highest to lowest):
 *   BUY_VOUCHER_PACK / NEW_MEMBER / RENEWAL > VOUCHER > MEMBER > REGULAR (fallback)
 *
 * 'regular' is ONLY assigned when no other tag applies.
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4
 */

/**
 * Context about an order's content used to determine applicable customer tags.
 */
export interface OrderContext {
  /** Order contains a voucher pack sale */
  hasVoucherPackPurchase: boolean;
  /** Order creates a new membership */
  hasNewMembership: boolean;
  /** Order renews an existing membership */
  hasMembershipRenewal: boolean;
  /** Order uses voucher codes */
  hasVoucherRedemption: boolean;
  /** Order uses membership pricing (free or discounted services) */
  hasMemberBenefitsApplied: boolean;
}

/**
 * Valid customer type tags matching the order_tags CHECK constraint.
 */
export type CustomerTag =
  | 'regular'
  | 'member'
  | 'voucher'
  | 'new_member'
  | 'renewal'
  | 'buy_voucher_pack';

/**
 * Assigns customer type tags based on order content.
 *
 * All applicable tags are assigned simultaneously. The 'regular' tag is only
 * assigned as a fallback when no other condition is met.
 *
 * @param context - The order context describing what the order contains
 * @returns Array of applicable customer tags (never empty)
 */
export function assignCustomerTags(context: OrderContext): CustomerTag[] {
  const tags: CustomerTag[] = [];

  if (context.hasVoucherPackPurchase) {
    tags.push('buy_voucher_pack');
  }

  if (context.hasNewMembership) {
    tags.push('new_member');
  }

  if (context.hasMembershipRenewal) {
    tags.push('renewal');
  }

  if (context.hasVoucherRedemption) {
    tags.push('voucher');
  }

  if (context.hasMemberBenefitsApplied) {
    tags.push('member');
  }

  // Fallback: 'regular' is ONLY assigned if no other tag applies
  if (tags.length === 0) {
    tags.push('regular');
  }

  return tags;
}

/**
 * Returns the tags that should remain after an order is voided.
 *
 * On void, all tags are removed (reverted) so the order is excluded
 * from reporting aggregations.
 *
 * @returns Empty array indicating all tags should be removed
 */
export function revertCustomerTags(): CustomerTag[] {
  return [];
}
