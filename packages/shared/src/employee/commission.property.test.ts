import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateCommission, CommissionInput, CommissionRule } from './index';

/**
 * Property-based tests for commission calculation correctness.
 *
 * **Validates: Requirements 29.4**
 */

// --- Arbitrary Generators ---

/** Generate a non-negative order total (integer cents to avoid floating-point issues) */
const arbOrderTotal = fc.integer({ min: 0, max: 10_000_000 });

/** Generate a single order entry */
const arbOrder = fc.record({
  total: arbOrderTotal,
  isVoided: fc.boolean(),
});

/** Generate a list of orders */
const arbOrders = fc.array(arbOrder, { minLength: 0, maxLength: 50 });

/** Generate a percentage value between 0 and 1 (inclusive) */
const arbPercentage = fc.double({ min: 0, max: 1, noNaN: true });

/** Generate a non-negative fixed commission value */
const arbFixedValue = fc.integer({ min: 0, max: 100_000 });

/** Generate a percentage commission rule */
const arbPercentageRule: fc.Arbitrary<CommissionRule> = arbPercentage.map((value) => ({
  type: 'percentage' as const,
  value,
}));

/** Generate a per-order commission rule */
const arbPerOrderRule: fc.Arbitrary<CommissionRule> = arbFixedValue.map((value) => ({
  type: 'per_order' as const,
  value,
}));

/** Generate a tiered commission rule with sorted, unique minRevenue thresholds */
const arbTieredRule: fc.Arbitrary<CommissionRule> = fc
  .array(
    fc.record({
      minRevenue: fc.integer({ min: 0, max: 5_000_000 }),
      percentage: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { minLength: 1, maxLength: 5 },
  )
  .map((tiers) => {
    // Ensure unique minRevenue values by deduplicating
    const seen = new Set<number>();
    const uniqueTiers = tiers.filter((t) => {
      if (seen.has(t.minRevenue)) return false;
      seen.add(t.minRevenue);
      return true;
    });
    return { type: 'tiered' as const, tiers: uniqueTiers };
  });

/** Generate any commission rule */
const arbRule: fc.Arbitrary<CommissionRule> = fc.oneof(
  arbPercentageRule,
  arbPerOrderRule,
  arbTieredRule,
);

/** Generate a full CommissionInput */
const arbCommissionInput: fc.Arbitrary<CommissionInput> = fc.record({
  rule: arbRule,
  completedOrders: arbOrders,
});

describe('Commission Calculation Correctness - Property-Based Tests', () => {
  describe('Property 32: Commission Calculation Correctness', () => {
    it('voided exclusion: totalRevenue only includes orders where isVoided === false', () => {
      fc.assert(
        fc.property(arbRule, arbOrders, (rule, completedOrders) => {
          const result = calculateCommission({ rule, completedOrders });

          const expectedRevenue = completedOrders
            .filter((o) => !o.isVoided)
            .reduce((sum, o) => sum + o.total, 0);

          expect(result.totalRevenue).toBe(expectedRevenue);
        }),
        { numRuns: 500 },
      );
    });

    it('ordersConsidered equals count of non-voided orders', () => {
      fc.assert(
        fc.property(arbRule, arbOrders, (rule, completedOrders) => {
          const result = calculateCommission({ rule, completedOrders });

          const expectedCount = completedOrders.filter((o) => !o.isVoided).length;

          expect(result.ordersConsidered).toBe(expectedCount);
        }),
        { numRuns: 500 },
      );
    });

    it('percentage correctness: commission = totalRevenue * rule.value for percentage type', () => {
      fc.assert(
        fc.property(arbPercentageRule, arbOrders, (rule, completedOrders) => {
          const result = calculateCommission({ rule, completedOrders });

          const expectedCommission = result.totalRevenue * rule.value;

          expect(result.totalCommission).toBeCloseTo(expectedCommission, 5);
        }),
        { numRuns: 500 },
      );
    });

    it('per-order correctness: commission = ordersConsidered * rule.value for per_order type', () => {
      fc.assert(
        fc.property(arbPerOrderRule, arbOrders, (rule, completedOrders) => {
          const result = calculateCommission({ rule, completedOrders });

          const expectedCommission = result.ordersConsidered * rule.value;

          expect(result.totalCommission).toBe(expectedCommission);
        }),
        { numRuns: 500 },
      );
    });

    it('non-negativity: totalCommission is always >= 0', () => {
      fc.assert(
        fc.property(arbCommissionInput, (input) => {
          const result = calculateCommission(input);

          expect(result.totalCommission).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 500 },
      );
    });

    it('tiered: highest applicable tier wins - the tier with the highest minRevenue <= totalRevenue is applied', () => {
      fc.assert(
        fc.property(arbTieredRule, arbOrders, (rule, completedOrders) => {
          if (rule.type !== 'tiered') return; // Type guard

          const result = calculateCommission({ rule, completedOrders });

          // Manually determine expected commission using the same logic
          const nonVoidedRevenue = completedOrders
            .filter((o) => !o.isVoided)
            .reduce((sum, o) => sum + o.total, 0);

          // Find highest applicable tier (highest minRevenue that is <= totalRevenue)
          const applicableTiers = rule.tiers.filter(
            (t) => nonVoidedRevenue >= t.minRevenue,
          );

          let expectedCommission: number;
          if (applicableTiers.length === 0) {
            expectedCommission = 0;
          } else {
            // The highest applicable tier
            const highestTier = applicableTiers.reduce((best, t) =>
              t.minRevenue > best.minRevenue ? t : best,
            );
            expectedCommission = nonVoidedRevenue * highestTier.percentage;
          }

          expect(result.totalCommission).toBeCloseTo(expectedCommission, 5);
        }),
        { numRuns: 500 },
      );
    });
  });
});
