import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateUpgradeCredit, UpgradeCreditInput } from './upgrade-credit';

/**
 * Property-based tests for upgrade credit calculation.
 *
 * **Validates: Requirements 14.3**
 */

// --- Arbitrary Generators ---

/**
 * Generates an arbitrary wash item with reasonable price/quantity/discount ranges.
 */
const arbWashItem = fc.record({
  quantity: fc.integer({ min: 1, max: 20 }),
  unitPrice: fc.integer({ min: 0, max: 500000 }),
  discount: fc.integer({ min: 0, max: 500000 }),
});

/**
 * Generates an arbitrary list of wash items.
 */
const arbWashItems = fc.array(arbWashItem, { minLength: 0, maxLength: 10 });

/**
 * Generates an arbitrary plan price (non-negative integer).
 */
const arbPlanPrice = fc.integer({ min: 0, max: 1000000 });

/**
 * Generates a complete UpgradeCreditInput.
 */
const arbUpgradeCreditInput: fc.Arbitrary<UpgradeCreditInput> = fc.record({
  planPrice: arbPlanPrice,
  washItems: arbWashItems,
});

describe('Upgrade Credit Calculation - Property-Based Tests', () => {
  describe('Property 20: Upgrade Credit Calculation', () => {
    it('formula correctness: chargedAmount = max(0, planPrice - sum(max(0, item.qty * item.unitPrice - item.discount)))', () => {
      fc.assert(
        fc.property(arbUpgradeCreditInput, (input) => {
          const result = calculateUpgradeCredit(input);

          const expectedWashCredit = input.washItems.reduce((sum, item) => {
            const itemValue = item.quantity * item.unitPrice - item.discount;
            return sum + Math.max(0, itemValue);
          }, 0);

          const expectedChargedAmount = Math.max(0, input.planPrice - expectedWashCredit);

          expect(result.washCredit).toBe(expectedWashCredit);
          expect(result.chargedAmount).toBe(expectedChargedAmount);
        }),
        { numRuns: 500 },
      );
    });

    it('non-negativity: chargedAmount is always >= 0', () => {
      fc.assert(
        fc.property(arbUpgradeCreditInput, (input) => {
          const result = calculateUpgradeCredit(input);

          expect(result.chargedAmount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 500 },
      );
    });

    it('bounded: chargedAmount never exceeds planPrice', () => {
      fc.assert(
        fc.property(arbUpgradeCreditInput, (input) => {
          const result = calculateUpgradeCredit(input);

          expect(result.chargedAmount).toBeLessThanOrEqual(input.planPrice);
        }),
        { numRuns: 500 },
      );
    });

    it('zero wash items: chargedAmount equals planPrice when washItems is empty', () => {
      fc.assert(
        fc.property(arbPlanPrice, (planPrice) => {
          const result = calculateUpgradeCredit({ planPrice, washItems: [] });

          expect(result.washCredit).toBe(0);
          expect(result.chargedAmount).toBe(planPrice);
        }),
        { numRuns: 500 },
      );
    });

    it('wash credit bounds: washCredit is always >= 0', () => {
      fc.assert(
        fc.property(arbUpgradeCreditInput, (input) => {
          const result = calculateUpgradeCredit(input);

          expect(result.washCredit).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 500 },
      );
    });

    it('credit conservation: washCredit + chargedAmount >= planPrice, with equality when chargedAmount > 0', () => {
      fc.assert(
        fc.property(arbUpgradeCreditInput, (input) => {
          const result = calculateUpgradeCredit(input);

          // washCredit + chargedAmount >= planPrice always holds
          expect(result.washCredit + result.chargedAmount).toBeGreaterThanOrEqual(result.planPrice);

          // When chargedAmount > 0, it means washCredit < planPrice,
          // so chargedAmount = planPrice - washCredit, meaning washCredit + chargedAmount == planPrice
          if (result.chargedAmount > 0) {
            expect(result.washCredit + result.chargedAmount).toBe(result.planPrice);
          }

          // When chargedAmount == 0, it means washCredit >= planPrice (credit exceeds plan price)
          if (result.chargedAmount === 0) {
            expect(result.washCredit).toBeGreaterThanOrEqual(result.planPrice);
          }
        }),
        { numRuns: 500 },
      );
    });
  });
});
