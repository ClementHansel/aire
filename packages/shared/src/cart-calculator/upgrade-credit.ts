/**
 * Upgrade credit calculation for membership plan purchases.
 *
 * When a customer buys a membership plan alongside wash services in the same order,
 * the wash value is credited towards the plan price so they only pay the difference.
 *
 * Requirements: 14.3
 */

export interface UpgradeCreditInput {
  planPrice: number; // price of the membership plan being purchased
  washItems: Array<{
    // wash items in the same order
    quantity: number;
    unitPrice: number;
    discount: number;
  }>;
}

export interface UpgradeCreditResult {
  planPrice: number; // original plan price
  washCredit: number; // sum of wash item values (qty * unitPrice - discount)
  chargedAmount: number; // planPrice - washCredit, floored at 0
}

/**
 * Calculates the upgrade credit when a membership plan is purchased alongside wash services.
 *
 * - washCredit = sum of (item.quantity * item.unitPrice - item.discount) for each wash item
 * - chargedAmount = Math.max(0, planPrice - washCredit)
 * - If washCredit >= planPrice, the membership is effectively free (chargedAmount = 0)
 */
export function calculateUpgradeCredit(input: UpgradeCreditInput): UpgradeCreditResult {
  const { planPrice, washItems } = input;

  const washCredit = washItems.reduce((sum, item) => {
    const itemValue = item.quantity * item.unitPrice - item.discount;
    return sum + Math.max(0, itemValue);
  }, 0);

  const chargedAmount = Math.max(0, planPrice - washCredit);

  return {
    planPrice,
    washCredit,
    chargedAmount,
  };
}
