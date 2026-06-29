import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CartItem,
  CartConfig,
  calculateCartSummary,
  addToCart,
  removeFromCart,
  updateQuantity,
  applyManualDiscount,
} from './index';

/**
 * Property-based tests for cart total integrity.
 *
 * **Validates: Requirements 6.7, 6.8**
 */

// --- Arbitrary Generators ---

/**
 * Generates an arbitrary CartItem with reasonable price/quantity/discount ranges.
 */
const arbCartItem: fc.Arbitrary<CartItem> = fc.record({
  serviceId: fc.uuid(),
  serviceName: fc.string({ minLength: 1, maxLength: 20 }),
  quantity: fc.integer({ min: 1, max: 50 }),
  unitPrice: fc.integer({ min: 0, max: 500000 }),
  discount: fc.integer({ min: 0, max: 200000 }),
  isMainService: fc.boolean(),
});

/**
 * Generates an arbitrary CartConfig with valid percentages.
 */
const arbCartConfig: fc.Arbitrary<CartConfig> = fc.record({
  serviceChargePct: fc.double({ min: 0, max: 0.5, noNaN: true }),
  taxPct: fc.double({ min: 0, max: 0.5, noNaN: true }),
  maxManualDiscountPct: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
});

/**
 * Generates a non-negative discount amount.
 */
const arbDiscount = fc.integer({ min: 0, max: 1000000 });

/**
 * Generates a list of cart items with unique serviceIds.
 */
const arbCartItems: fc.Arbitrary<CartItem[]> = fc
  .array(arbCartItem, { minLength: 0, maxLength: 10 })
  .map((items) => {
    // Ensure unique serviceIds
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.serviceId)) return false;
      seen.add(item.serviceId);
      return true;
    });
  });

describe('Cart Total Integrity - Property-Based Tests', () => {
  describe('Property 6: Cart Total Integrity', () => {
    it('total formula correctness: total = max(0, subtotal + serviceCharge + tax - voucherDiscount - promoDiscount)', () => {
      fc.assert(
        fc.property(
          arbCartItems,
          arbCartConfig,
          arbDiscount,
          arbDiscount,
          (items, config, voucherDiscount, promoDiscount) => {
            const result = calculateCartSummary(items, config, voucherDiscount, promoDiscount);

            const expectedRaw =
              result.subtotal + result.serviceCharge + result.tax - voucherDiscount - promoDiscount;
            const expectedTotal = Math.max(0, expectedRaw);

            expect(result.total).toBeCloseTo(expectedTotal, 5);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('subtotal formula correctness: subtotal = sum of max(0, item.qty * item.unitPrice - item.discount)', () => {
      fc.assert(
        fc.property(arbCartItems, arbCartConfig, (items, config) => {
          const result = calculateCartSummary(items, config);

          const expectedSubtotal = items.reduce((sum, item) => {
            return sum + Math.max(0, item.quantity * item.unitPrice - item.discount);
          }, 0);

          expect(result.subtotal).toBeCloseTo(expectedSubtotal, 5);
        }),
        { numRuns: 500 },
      );
    });

    it('non-negativity: total is always >= 0', () => {
      fc.assert(
        fc.property(
          arbCartItems,
          arbCartConfig,
          arbDiscount,
          arbDiscount,
          (items, config, voucherDiscount, promoDiscount) => {
            const result = calculateCartSummary(items, config, voucherDiscount, promoDiscount);

            expect(result.total).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 500 },
      );
    });

    it('operation invariance: after any add/remove/updateQuantity sequence, the formula still holds', () => {
      // Model operations as a sequence and verify the formula holds after each
      const arbOperation = fc.oneof(
        fc.record({ type: fc.constant('add' as const), item: arbCartItem }),
        fc.record({
          type: fc.constant('remove' as const),
          serviceId: fc.uuid(),
        }),
        fc.record({
          type: fc.constant('updateQty' as const),
          serviceId: fc.uuid(),
          quantity: fc.integer({ min: 0, max: 20 }),
        }),
      );

      fc.assert(
        fc.property(
          arbCartItems,
          arbCartConfig,
          arbDiscount,
          arbDiscount,
          fc.array(arbOperation, { minLength: 1, maxLength: 10 }),
          (initialItems, config, voucherDiscount, promoDiscount, operations) => {
            let items = [...initialItems];

            // Apply operations
            for (const op of operations) {
              switch (op.type) {
                case 'add':
                  items = addToCart(items, op.item);
                  break;
                case 'remove':
                  items = removeFromCart(items, op.serviceId);
                  break;
                case 'updateQty':
                  items = updateQuantity(items, op.serviceId, op.quantity);
                  break;
              }
            }

            // Verify total formula holds after operations
            const result = calculateCartSummary(items, config, voucherDiscount, promoDiscount);

            const expectedSubtotal = items.reduce((sum, item) => {
              return sum + Math.max(0, item.quantity * item.unitPrice - item.discount);
            }, 0);

            const expectedServiceCharge = expectedSubtotal * config.serviceChargePct;
            const expectedTax = expectedSubtotal * config.taxPct;
            const expectedRaw =
              expectedSubtotal + expectedServiceCharge + expectedTax - voucherDiscount - promoDiscount;
            const expectedTotal = Math.max(0, expectedRaw);

            expect(result.subtotal).toBeCloseTo(expectedSubtotal, 5);
            expect(result.serviceCharge).toBeCloseTo(expectedServiceCharge, 5);
            expect(result.tax).toBeCloseTo(expectedTax, 5);
            expect(result.total).toBeCloseTo(expectedTotal, 5);
          },
        ),
        { numRuns: 300 },
      );
    });

    it('idempotency of calculation: calculateCartSummary with same inputs always produces same output', () => {
      fc.assert(
        fc.property(
          arbCartItems,
          arbCartConfig,
          arbDiscount,
          arbDiscount,
          (items, config, voucherDiscount, promoDiscount) => {
            const result1 = calculateCartSummary(items, config, voucherDiscount, promoDiscount);
            const result2 = calculateCartSummary(items, config, voucherDiscount, promoDiscount);

            expect(result1.subtotal).toBe(result2.subtotal);
            expect(result1.serviceCharge).toBe(result2.serviceCharge);
            expect(result1.tax).toBe(result2.tax);
            expect(result1.voucherDiscount).toBe(result2.voucherDiscount);
            expect(result1.promoDiscount).toBe(result2.promoDiscount);
            expect(result1.total).toBe(result2.total);
          },
        ),
        { numRuns: 300 },
      );
    });

    it('monotonicity: adding an item with price > 0 and discount = 0 never decreases subtotal', () => {
      const arbPositivePriceItem: fc.Arbitrary<CartItem> = fc.record({
        serviceId: fc.uuid(),
        serviceName: fc.string({ minLength: 1, maxLength: 20 }),
        quantity: fc.integer({ min: 1, max: 50 }),
        unitPrice: fc.integer({ min: 1, max: 500000 }),
        discount: fc.constant(0),
        isMainService: fc.boolean(),
      });

      fc.assert(
        fc.property(
          arbCartItems,
          arbCartConfig,
          arbPositivePriceItem,
          (initialItems, config, newItem) => {
            const beforeResult = calculateCartSummary(initialItems, config);
            const afterItems = addToCart(initialItems, newItem);
            const afterResult = calculateCartSummary(afterItems, config);

            expect(afterResult.subtotal).toBeGreaterThanOrEqual(beforeResult.subtotal);
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
