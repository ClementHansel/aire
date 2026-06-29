import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { aggregateOrders, OrderForReport } from './index';
import { OrderStatus, PaymentMethod } from '../enums';

/**
 * Property-based tests for report summary aggregation accuracy.
 *
 * **Validates: Requirements 23.1, 23.2**
 */

// --- Arbitrary Generators ---

const arbOrderStatus: fc.Arbitrary<OrderStatus> = fc.constantFrom(
  OrderStatus.Ordered,
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
  OrderStatus.Cancelled,
);

const arbPaymentMethod: fc.Arbitrary<PaymentMethod> = fc.constantFrom(
  PaymentMethod.Cash,
  PaymentMethod.QrisStatic,
  PaymentMethod.QrisDynamic,
  PaymentMethod.Edc,
  PaymentMethod.Transfer,
);

const arbNullablePaymentMethod: fc.Arbitrary<PaymentMethod | null> = fc.oneof(
  arbPaymentMethod,
  fc.constant(null),
);

const arbOrderForReport: fc.Arbitrary<OrderForReport> = fc.record({
  status: arbOrderStatus,
  total: fc.integer({ min: 0, max: 10_000_000 }),
  paymentMethod: arbNullablePaymentMethod,
  membershipId: fc.oneof(fc.uuid(), fc.constant(null)),
  customerId: fc.oneof(fc.uuid(), fc.constant(null)),
});

const arbOrderList: fc.Arbitrary<OrderForReport[]> = fc.array(arbOrderForReport, {
  minLength: 0,
  maxLength: 100,
});

/**
 * Statuses that count towards revenue.
 */
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
];

describe('Report Summary Aggregation Accuracy - Property-Based Tests', () => {
  describe('Property 23: Report Summary Aggregation Accuracy', () => {
    it('totalOrders equals the count of all orders in the input', () => {
      fc.assert(
        fc.property(arbOrderList, (orders) => {
          const result = aggregateOrders(orders);
          expect(result.totalOrders).toBe(orders.length);
        }),
        { numRuns: 500 },
      );
    });

    it('revenue equals sum of total for orders with status in (paid, confirmed, completed)', () => {
      fc.assert(
        fc.property(arbOrderList, (orders) => {
          const result = aggregateOrders(orders);
          const expectedRevenue = orders
            .filter((o) => REVENUE_STATUSES.includes(o.status))
            .reduce((sum, o) => sum + o.total, 0);
          expect(result.revenue).toBe(expectedRevenue);
        }),
        { numRuns: 500 },
      );
    });

    it('paidCount equals the count of orders with status in (paid, confirmed, completed)', () => {
      fc.assert(
        fc.property(arbOrderList, (orders) => {
          const result = aggregateOrders(orders);
          const expectedPaidCount = orders.filter((o) =>
            REVENUE_STATUSES.includes(o.status),
          ).length;
          expect(result.paidCount).toBe(expectedPaidCount);
        }),
        { numRuns: 500 },
      );
    });

    it('cancelledCount equals the count of orders with status = cancelled', () => {
      fc.assert(
        fc.property(arbOrderList, (orders) => {
          const result = aggregateOrders(orders);
          const expectedCancelledCount = orders.filter(
            (o) => o.status === OrderStatus.Cancelled,
          ).length;
          expect(result.cancelledCount).toBe(expectedCancelledCount);
        }),
        { numRuns: 500 },
      );
    });

    it('payment method breakdown revenue sums to total revenue (conservation property)', () => {
      fc.assert(
        fc.property(arbOrderList, (orders) => {
          const result = aggregateOrders(orders);

          // Sum of all payment method breakdown revenues
          const breakdownRevenue = Object.values(result.byPaymentMethod).reduce(
            (sum, entry) => sum + entry.revenue,
            0,
          );

          // Revenue from orders that have a paymentMethod set and are revenue-contributing
          const revenueFromMethodOrders = orders
            .filter(
              (o) =>
                REVENUE_STATUSES.includes(o.status) && o.paymentMethod !== null,
            )
            .reduce((sum, o) => sum + o.total, 0);

          // The breakdown should account for all revenue from orders with a payment method
          expect(breakdownRevenue).toBe(revenueFromMethodOrders);

          // Additionally: breakdown revenue <= total revenue (since null-method orders don't appear in breakdown)
          expect(breakdownRevenue).toBeLessThanOrEqual(result.revenue);
        }),
        { numRuns: 500 },
      );
    });

    it('payment method breakdown counts sum to paid count for orders with payment methods', () => {
      fc.assert(
        fc.property(arbOrderList, (orders) => {
          const result = aggregateOrders(orders);

          // Sum of all payment method breakdown counts
          const breakdownCount = Object.values(result.byPaymentMethod).reduce(
            (sum, entry) => sum + entry.count,
            0,
          );

          // Count of revenue-contributing orders with non-null payment method
          const countWithMethod = orders.filter(
            (o) =>
              REVENUE_STATUSES.includes(o.status) && o.paymentMethod !== null,
          ).length;

          expect(breakdownCount).toBe(countWithMethod);
        }),
        { numRuns: 500 },
      );
    });
  });
});
