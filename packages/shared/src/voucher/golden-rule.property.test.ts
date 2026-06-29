import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyGoldenRule, CartItemWithBenefits, GoldenRuleResult } from './golden-rule';

/**
 * Property-based tests for Golden Rule: Voucher Wins Over Membership.
 *
 * **Validates: Requirements 17.5**
 */

// --- Arbitrary Generators ---

/**
 * Generates an arbitrary CartItemWithBenefits with reasonable values.
 */
const arbCartItemWithBenefits: fc.Arbitrary<CartItemWithBenefits> = fc
  .record({
    serviceId: fc.uuid(),
    unitPrice: fc.integer({ min: 1, max: 500000 }),
    quantity: fc.integer({ min: 1, max: 20 }),
    hasMembershipBenefit: fc.boolean(),
    hasVoucherBenefit: fc.boolean(),
  })
  .chain((base) => {
    const membershipDiscount = base.hasMembershipBenefit
      ? fc.integer({ min: 1, max: base.unitPrice })
      : fc.constant(0);
    const voucherDiscount = base.hasVoucherBenefit
      ? fc.integer({ min: 1, max: base.unitPrice })
      : fc.constant(0);

    return fc.record({
      serviceId: fc.constant(base.serviceId),
      unitPrice: fc.constant(base.unitPrice),
      quantity: fc.constant(base.quantity),
      hasMembershipBenefit: fc.constant(base.hasMembershipBenefit),
      hasVoucherBenefit: fc.constant(base.hasVoucherBenefit),
      membershipDiscountAmount: membershipDiscount,
      voucherDiscountAmount: voucherDiscount,
    });
  });

/**
 * Generates item with BOTH membership and voucher benefits.
 */
const arbItemWithBothBenefits: fc.Arbitrary<CartItemWithBenefits> = fc
  .record({
    serviceId: fc.uuid(),
    unitPrice: fc.integer({ min: 1, max: 500000 }),
    quantity: fc.integer({ min: 1, max: 20 }),
  })
  .chain((base) =>
    fc.record({
      serviceId: fc.constant(base.serviceId),
      unitPrice: fc.constant(base.unitPrice),
      quantity: fc.constant(base.quantity),
      hasMembershipBenefit: fc.constant(true),
      hasVoucherBenefit: fc.constant(true),
      membershipDiscountAmount: fc.integer({ min: 1, max: base.unitPrice }),
      voucherDiscountAmount: fc.integer({ min: 1, max: base.unitPrice }),
    }),
  );

/**
 * Generates item with ONLY membership benefit (no voucher).
 */
const arbItemMembershipOnly: fc.Arbitrary<CartItemWithBenefits> = fc
  .record({
    serviceId: fc.uuid(),
    unitPrice: fc.integer({ min: 1, max: 500000 }),
    quantity: fc.integer({ min: 1, max: 20 }),
  })
  .chain((base) =>
    fc.record({
      serviceId: fc.constant(base.serviceId),
      unitPrice: fc.constant(base.unitPrice),
      quantity: fc.constant(base.quantity),
      hasMembershipBenefit: fc.constant(true),
      hasVoucherBenefit: fc.constant(false),
      membershipDiscountAmount: fc.integer({ min: 1, max: base.unitPrice }),
      voucherDiscountAmount: fc.constant(0),
    }),
  );

/**
 * Generates item with ONLY voucher benefit (no membership).
 */
const arbItemVoucherOnly: fc.Arbitrary<CartItemWithBenefits> = fc
  .record({
    serviceId: fc.uuid(),
    unitPrice: fc.integer({ min: 1, max: 500000 }),
    quantity: fc.integer({ min: 1, max: 20 }),
  })
  .chain((base) =>
    fc.record({
      serviceId: fc.constant(base.serviceId),
      unitPrice: fc.constant(base.unitPrice),
      quantity: fc.constant(base.quantity),
      hasMembershipBenefit: fc.constant(false),
      hasVoucherBenefit: fc.constant(true),
      membershipDiscountAmount: fc.constant(0),
      voucherDiscountAmount: fc.integer({ min: 1, max: base.unitPrice }),
    }),
  );

/**
 * Generates item with NEITHER benefit.
 */
const arbItemNoBenefits: fc.Arbitrary<CartItemWithBenefits> = fc.record({
  serviceId: fc.uuid(),
  unitPrice: fc.integer({ min: 1, max: 500000 }),
  quantity: fc.integer({ min: 1, max: 20 }),
  hasMembershipBenefit: fc.constant(false),
  hasVoucherBenefit: fc.constant(false),
  membershipDiscountAmount: fc.constant(0),
  voucherDiscountAmount: fc.constant(0),
});

/**
 * Generates an array of CartItemWithBenefits with mixed benefit scenarios.
 */
const arbCartItems: fc.Arbitrary<CartItemWithBenefits[]> = fc.array(arbCartItemWithBenefits, {
  minLength: 0,
  maxLength: 15,
});

describe('Golden Rule - Property-Based Tests', () => {
  describe('Property 10: Golden Rule — Voucher Wins Over Membership', () => {
    it('when BOTH voucher and membership apply: appliedDiscount === "voucher" AND consumeMembershipQuota === false', () => {
      fc.assert(
        fc.property(
          fc.array(arbItemWithBothBenefits, { minLength: 1, maxLength: 10 }),
          (items) => {
            const results = applyGoldenRule(items);

            for (const result of results) {
              expect(result.appliedDiscount).toBe('voucher');
              expect(result.consumeMembershipQuota).toBe(false);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('when ONLY membership applies: appliedDiscount === "membership" AND consumeMembershipQuota === true', () => {
      fc.assert(
        fc.property(
          fc.array(arbItemMembershipOnly, { minLength: 1, maxLength: 10 }),
          (items) => {
            const results = applyGoldenRule(items);

            for (const result of results) {
              expect(result.appliedDiscount).toBe('membership');
              expect(result.consumeMembershipQuota).toBe(true);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('when ONLY voucher applies: appliedDiscount === "voucher" AND consumeMembershipQuota === false', () => {
      fc.assert(
        fc.property(
          fc.array(arbItemVoucherOnly, { minLength: 1, maxLength: 10 }),
          (items) => {
            const results = applyGoldenRule(items);

            for (const result of results) {
              expect(result.appliedDiscount).toBe('voucher');
              expect(result.consumeMembershipQuota).toBe(false);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('when NEITHER benefit applies: appliedDiscount === "none" AND consumeMembershipQuota === false', () => {
      fc.assert(
        fc.property(
          fc.array(arbItemNoBenefits, { minLength: 1, maxLength: 10 }),
          (items) => {
            const results = applyGoldenRule(items);

            for (const result of results) {
              expect(result.appliedDiscount).toBe('none');
              expect(result.consumeMembershipQuota).toBe(false);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('consumeMembershipQuota is true ONLY when membership applies exclusively (no voucher)', () => {
      fc.assert(
        fc.property(arbCartItems, (items) => {
          const results = applyGoldenRule(items);

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const item = items[i];

            if (result.consumeMembershipQuota) {
              // When quota is consumed, it MUST be membership-only
              expect(item.hasMembershipBenefit).toBe(true);
              expect(item.hasVoucherBenefit).toBe(false);
              expect(result.appliedDiscount).toBe('membership');
            } else {
              // When quota is NOT consumed, it must NOT be membership-exclusive
              if (item.hasMembershipBenefit && !item.hasVoucherBenefit) {
                // This case SHOULD consume quota — fail if it doesn't
                expect(result.consumeMembershipQuota).toBe(true);
              }
            }
          }
        }),
        { numRuns: 500 },
      );
    });

    it('result array has same length as input array (1:1 correspondence)', () => {
      fc.assert(
        fc.property(arbCartItems, (items) => {
          const results = applyGoldenRule(items);
          expect(results).toHaveLength(items.length);
        }),
        { numRuns: 500 },
      );
    });
  });
});
