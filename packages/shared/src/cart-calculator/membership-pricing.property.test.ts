import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CartItem } from './index';
import {
  applyMembershipPricing,
  MembershipBenefit,
} from './membership-pricing';

/**
 * Property-based tests for membership pricing application.
 *
 * **Validates: Requirements 6.6, 12.3, 12.4**
 */

// --- Arbitrary Generators ---

/**
 * Generates an arbitrary service ID from a fixed pool so benefits can reference them.
 */
const arbServiceId = fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '1', '2', '3'), {
  minLength: 3,
  maxLength: 8,
});

/**
 * Generates an arbitrary CartItem with reasonable values.
 */
const arbCartItem: fc.Arbitrary<CartItem> = fc.record({
  serviceId: arbServiceId,
  serviceName: fc.string({ minLength: 1, maxLength: 20 }),
  quantity: fc.integer({ min: 1, max: 20 }),
  unitPrice: fc.integer({ min: 0, max: 500000 }),
  discount: fc.constant(0), // membership pricing starts from 0 discount
  isMainService: fc.boolean(),
});

/**
 * Generates a list of cart items with unique serviceIds.
 */
const arbCartItems: fc.Arbitrary<CartItem[]> = fc
  .array(arbCartItem, { minLength: 1, maxLength: 8 })
  .map((items) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.serviceId)) return false;
      seen.add(item.serviceId);
      return true;
    });
  })
  .filter((items) => items.length > 0);

/**
 * Generates an arbitrary MembershipBenefit that references service IDs from a given pool.
 */
function arbMembershipBenefit(serviceIdPool: string[]): fc.Arbitrary<MembershipBenefit> {
  return fc.record({
    membershipId: fc.uuid(),
    planName: fc.string({ minLength: 1, maxLength: 15 }),
    freeServiceIds: fc.subarray(serviceIdPool, { minLength: 0, maxLength: serviceIdPool.length }),
    discountedServices: fc
      .subarray(serviceIdPool, { minLength: 0, maxLength: serviceIdPool.length })
      .chain((ids) =>
        fc.tuple(
          fc.constant(ids),
          fc.array(fc.double({ min: 0.01, max: 0.99, noNaN: true }), {
            minLength: ids.length,
            maxLength: ids.length,
          }),
        ),
      )
      .map(([ids, pcts]) =>
        ids.map((serviceId, i) => ({ serviceId, discountPct: pcts[i] })),
      ),
  });
}

/**
 * Generates cart items and matching benefits that ensure some items appear in benefits.
 */
const arbItemsAndBenefits: fc.Arbitrary<{
  items: CartItem[];
  benefits: MembershipBenefit[];
}> = arbCartItems.chain((items) => {
  const serviceIds = items.map((i) => i.serviceId);
  return fc
    .array(arbMembershipBenefit(serviceIds), { minLength: 1, maxLength: 3 })
    .map((benefits) => ({ items, benefits }));
});

/**
 * Generates an item explicitly in a free services list.
 */
const arbFreeServiceScenario: fc.Arbitrary<{
  item: CartItem;
  benefit: MembershipBenefit;
}> = arbCartItem.chain((item) =>
  fc
    .record({
      membershipId: fc.uuid(),
      planName: fc.string({ minLength: 1, maxLength: 15 }),
      freeServiceIds: fc.constant([item.serviceId]),
      discountedServices: fc.constant([]),
    })
    .map((benefit) => ({ item, benefit })),
);

/**
 * Generates an item explicitly in a discounted services list with a known percentage.
 */
const arbDiscountedServiceScenario: fc.Arbitrary<{
  item: CartItem;
  benefit: MembershipBenefit;
  discountPct: number;
}> = fc
  .tuple(arbCartItem, fc.double({ min: 0.01, max: 0.99, noNaN: true }))
  .chain(([item, discountPct]) =>
    fc
      .record({
        membershipId: fc.uuid(),
        planName: fc.string({ minLength: 1, maxLength: 15 }),
        freeServiceIds: fc.constant([]),
        discountedServices: fc.constant([{ serviceId: item.serviceId, discountPct }]),
      })
      .map((benefit) => ({ item, benefit, discountPct })),
  );

describe('Membership Pricing Application - Property-Based Tests', () => {
  describe('Property 19: Membership Pricing Application', () => {
    it('free services: discount equals unitPrice * quantity (effective price = 0)', () => {
      fc.assert(
        fc.property(arbFreeServiceScenario, ({ item, benefit }) => {
          const result = applyMembershipPricing([item], [benefit]);

          const expectedDiscount = item.unitPrice * item.quantity;
          expect(result.items[0].discount).toBe(expectedDiscount);

          // Applied pricing metadata
          expect(result.appliedPricing).toHaveLength(1);
          expect(result.appliedPricing[0].appliedPrice).toBe(0);
          expect(result.appliedPricing[0].originalPrice).toBe(item.unitPrice * item.quantity);
        }),
        { numRuns: 500 },
      );
    });

    it('discounted services: discount = unitPrice * quantity * discountPct', () => {
      fc.assert(
        fc.property(arbDiscountedServiceScenario, ({ item, benefit, discountPct }) => {
          const result = applyMembershipPricing([item], [benefit]);

          const expectedDiscount = item.unitPrice * item.quantity * discountPct;
          expect(result.items[0].discount).toBeCloseTo(expectedDiscount, 5);

          // Applied price = original - discount
          const originalPrice = item.unitPrice * item.quantity;
          expect(result.appliedPricing[0].appliedPrice).toBeCloseTo(
            originalPrice - expectedDiscount,
            5,
          );
        }),
        { numRuns: 500 },
      );
    });

    it('multiple plans: free always wins over percentage discount for the same service', () => {
      const arbMultiPlanFreeWins = arbCartItem.chain((item) =>
        fc
          .tuple(
            fc.uuid(),
            fc.uuid(),
            fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          )
          .map(([memId1, memId2, pct]) => ({
            item,
            benefits: [
              {
                membershipId: memId1,
                planName: 'Discount Plan',
                freeServiceIds: [] as string[],
                discountedServices: [{ serviceId: item.serviceId, discountPct: pct }],
              },
              {
                membershipId: memId2,
                planName: 'Free Plan',
                freeServiceIds: [item.serviceId],
                discountedServices: [],
              },
            ] as MembershipBenefit[],
          })),
      );

      fc.assert(
        fc.property(arbMultiPlanFreeWins, ({ item, benefits }) => {
          const result = applyMembershipPricing([item], benefits);

          // Free should win — discount covers full price
          expect(result.items[0].discount).toBe(item.unitPrice * item.quantity);
          expect(result.appliedPricing[0].discountType).toBe('free');
          expect(result.appliedPricing[0].appliedPrice).toBe(0);
        }),
        { numRuns: 500 },
      );
    });

    it('multiple plans: highest percentage discount wins over lower percentage', () => {
      const arbMultiPlanPercentage = arbCartItem.chain((item) =>
        fc
          .tuple(
            fc.uuid(),
            fc.uuid(),
            fc.double({ min: 0.01, max: 0.49, noNaN: true }),
            fc.double({ min: 0.50, max: 0.99, noNaN: true }),
          )
          .map(([memId1, memId2, lowPct, highPct]) => ({
            item,
            lowPct,
            highPct,
            benefits: [
              {
                membershipId: memId1,
                planName: 'Low Plan',
                freeServiceIds: [] as string[],
                discountedServices: [{ serviceId: item.serviceId, discountPct: lowPct }],
              },
              {
                membershipId: memId2,
                planName: 'High Plan',
                freeServiceIds: [] as string[],
                discountedServices: [{ serviceId: item.serviceId, discountPct: highPct }],
              },
            ] as MembershipBenefit[],
          })),
      );

      fc.assert(
        fc.property(arbMultiPlanPercentage, ({ item, highPct, benefits }) => {
          const result = applyMembershipPricing([item], benefits);

          const expectedDiscount = item.unitPrice * item.quantity * highPct;
          expect(result.items[0].discount).toBeCloseTo(expectedDiscount, 5);
          expect(result.appliedPricing[0].discountValue).toBeCloseTo(highPct, 10);
        }),
        { numRuns: 500 },
      );
    });

    it('items NOT in any benefit: discount remains 0', () => {
      fc.assert(
        fc.property(arbItemsAndBenefits, ({ items, benefits }) => {
          const result = applyMembershipPricing(items, benefits);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const isInFree = benefits.some((b) => b.freeServiceIds.includes(item.serviceId));
            const isInDiscounted = benefits.some((b) =>
              b.discountedServices.some((ds) => ds.serviceId === item.serviceId),
            );

            if (!isInFree && !isInDiscounted) {
              // Item not covered by any benefit → discount should be unchanged (0)
              expect(result.items[i].discount).toBe(0);
            }
          }
        }),
        { numRuns: 500 },
      );
    });

    it('applied pricing metadata is consistent with actual discounts', () => {
      fc.assert(
        fc.property(arbItemsAndBenefits, ({ items, benefits }) => {
          const result = applyMembershipPricing(items, benefits);

          // Every applied pricing entry must correspond to a modified item
          for (const pricing of result.appliedPricing) {
            const itemIndex = result.items.findIndex(
              (i) => i.serviceId === pricing.serviceId,
            );
            expect(itemIndex).toBeGreaterThanOrEqual(0);

            const resultItem = result.items[itemIndex];
            const originalItem = items[itemIndex];

            // originalPrice = unitPrice * quantity
            expect(pricing.originalPrice).toBe(
              originalItem.unitPrice * originalItem.quantity,
            );

            // appliedPrice = originalPrice - discount applied
            expect(pricing.appliedPrice).toBeCloseTo(
              pricing.originalPrice - resultItem.discount,
              5,
            );

            // discountType/discountValue consistency
            if (pricing.discountType === 'free') {
              expect(pricing.discountValue).toBe(1.0);
              expect(pricing.appliedPrice).toBe(0);
              expect(resultItem.discount).toBe(pricing.originalPrice);
            } else {
              expect(pricing.discountValue).toBeGreaterThan(0);
              expect(pricing.discountValue).toBeLessThan(1);
              expect(resultItem.discount).toBeCloseTo(
                pricing.originalPrice * pricing.discountValue,
                5,
              );
            }
          }
        }),
        { numRuns: 500 },
      );
    });

    it('free services always get badge "GRATIS", percentage gets "MEMBER -X%"', () => {
      fc.assert(
        fc.property(arbItemsAndBenefits, ({ items, benefits }) => {
          const result = applyMembershipPricing(items, benefits);

          for (const pricing of result.appliedPricing) {
            if (pricing.discountType === 'free') {
              expect(pricing.badgeLabel).toBe('GRATIS');
            } else {
              const pctLabel = Math.round(pricing.discountValue * 100);
              expect(pricing.badgeLabel).toBe(`MEMBER -${pctLabel}%`);
            }
          }
        }),
        { numRuns: 500 },
      );
    });
  });
});
