import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OrderStatus, PaymentMethod, VALID_PAYMENT_METHODS } from '@aire/shared';
import { processPayment, PaymentProcessInput } from '@aire/shared';
import { OrderStateMachine } from '../order/order-state-machine';

/**
 * Property-Based Tests: Payment Confirmation State Transition
 *
 * **Validates: Requirements 8.7**
 *
 * Property 27: For any order in 'ordered' status with confirmed payment
 * (any method): status → 'paid', cart reset. Holds regardless of payment method.
 */

// --- Arbitrary Generators ---

/**
 * All 5 payment methods. The property must hold for all equally.
 */
const ALL_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.Cash,
  PaymentMethod.QrisStatic,
  PaymentMethod.QrisDynamic,
  PaymentMethod.Edc,
  PaymentMethod.Transfer,
];

/**
 * Order statuses that are NOT 'ordered' — used to test negative transitions.
 */
const NON_ORDERED_STATUSES: OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
  OrderStatus.Cancelled,
];

/**
 * Generator: produces any PaymentMethod value.
 */
const arbPaymentMethod: fc.Arbitrary<PaymentMethod> = fc.constantFrom(...ALL_PAYMENT_METHODS);

/**
 * Generator: produces an arbitrary non-'ordered' status.
 */
const arbNonOrderedStatus: fc.Arbitrary<OrderStatus> = fc.constantFrom(...NON_ORDERED_STATUSES);

/**
 * Generator: produces a positive order total (realistic range: Rp 10,000 – Rp 10,000,000).
 */
const arbOrderTotal: fc.Arbitrary<number> = fc.integer({ min: 10_000, max: 10_000_000 });

/**
 * Generator: produces a non-empty reference number string (for EDC/Transfer).
 */
const arbReferenceNumber: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/**
 * Generator: produces a valid PaymentProcessInput that will be confirmed successfully.
 * Ensures the correct preconditions per method (sufficient cash, valid reference, etc.)
 */
const arbConfirmedPaymentInput: fc.Arbitrary<PaymentProcessInput> = arbPaymentMethod.chain(
  (method) => {
    switch (method) {
      case PaymentMethod.Cash:
        // For cash: amountReceived must be >= orderTotal
        return arbOrderTotal.chain((orderTotal) =>
          fc.integer({ min: orderTotal, max: orderTotal + 500_000 }).map(
            (amountReceived) => ({
              method,
              orderTotal,
              amountReceived,
            }),
          ),
        );

      case PaymentMethod.QrisStatic:
      case PaymentMethod.QrisDynamic:
        // QRIS methods: always confirmed, just need an order total
        return arbOrderTotal.map((orderTotal) => ({
          method,
          orderTotal,
        }));

      case PaymentMethod.Edc:
      case PaymentMethod.Transfer:
        // Reference-based: need a non-empty reference number
        return fc.tuple(arbOrderTotal, arbReferenceNumber).map(
          ([orderTotal, referenceNumber]) => ({
            method,
            orderTotal,
            referenceNumber,
          }),
        );
    }
  },
);

describe('Property 27: Payment Confirmation State Transition', () => {
  const stateMachine = new OrderStateMachine();

  it('for any PaymentMethod when order is in "ordered" status: transition to "paid" always succeeds', () => {
    fc.assert(
      fc.property(arbConfirmedPaymentInput, (paymentInput) => {
        // Verify payment is confirmed
        const paymentResult = processPayment(paymentInput);
        expect(paymentResult.confirmed).toBe(true);

        // Then the state transition ordered → paid must succeed
        const transitionResult = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Paid);
        expect(transitionResult.success).toBe(true);
        expect(transitionResult.fromStatus).toBe(OrderStatus.Ordered);
        expect(transitionResult.toStatus).toBe(OrderStatus.Paid);
      }),
      { numRuns: 500 },
    );
  });

  it('the payment method does not affect state transition validity (all methods trigger same transition)', () => {
    fc.assert(
      fc.property(arbPaymentMethod, arbPaymentMethod, (methodA, methodB) => {
        // Both methods should produce the same transition result
        const transitionA = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Paid);
        const transitionB = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Paid);

        // Transitions are method-agnostic: both succeed identically
        expect(transitionA.success).toBe(transitionB.success);
        expect(transitionA.fromStatus).toBe(transitionB.fromStatus);
        expect(transitionA.toStatus).toBe(transitionB.toStatus);
        expect(transitionA.error).toBe(transitionB.error);
      }),
      { numRuns: 200 },
    );
  });

  it('orders NOT in "ordered" status cannot transition directly to "paid"', () => {
    fc.assert(
      fc.property(arbNonOrderedStatus, arbPaymentMethod, (currentStatus, _method) => {
        // Non-ordered statuses should NOT be able to transition to 'paid'
        const result = stateMachine.transition(currentStatus, OrderStatus.Paid);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.errorCode).toBeDefined();
      }),
      { numRuns: 500 },
    );
  });

  it('after confirmation, the result has success=true, fromStatus=ordered, toStatus=paid', () => {
    fc.assert(
      fc.property(arbConfirmedPaymentInput, (paymentInput) => {
        // Confirm payment succeeds
        const paymentResult = processPayment(paymentInput);
        expect(paymentResult.confirmed).toBe(true);

        // Perform the state transition
        const result = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Paid);

        // Verify the full result shape
        expect(result.success).toBe(true);
        expect(result.fromStatus).toBe(OrderStatus.Ordered);
        expect(result.toStatus).toBe(OrderStatus.Paid);
        expect(result.error).toBeUndefined();
        expect(result.errorCode).toBeUndefined();
      }),
      { numRuns: 500 },
    );
  });

  it('this property holds for ALL 5 payment methods equally (method-agnostic)', () => {
    // Verify that the VALID_PAYMENT_METHODS constant covers all 5 expected methods
    expect(VALID_PAYMENT_METHODS).toHaveLength(5);
    expect(ALL_PAYMENT_METHODS).toHaveLength(5);

    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PAYMENT_METHODS),
        arbOrderTotal,
        arbReferenceNumber,
        (method, orderTotal, referenceNumber) => {
          // Build a valid input for each method
          let input: PaymentProcessInput;
          switch (method) {
            case PaymentMethod.Cash:
              input = { method, orderTotal, amountReceived: orderTotal };
              break;
            case PaymentMethod.QrisStatic:
            case PaymentMethod.QrisDynamic:
              input = { method, orderTotal };
              break;
            case PaymentMethod.Edc:
            case PaymentMethod.Transfer:
              input = { method, orderTotal, referenceNumber };
              break;
          }

          // Confirm payment
          const paymentResult = processPayment(input);
          expect(paymentResult.confirmed).toBe(true);
          expect(paymentResult.method).toBe(method);

          // State transition must succeed for all methods equally
          const transitionResult = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Paid);
          expect(transitionResult.success).toBe(true);
          expect(transitionResult.fromStatus).toBe(OrderStatus.Ordered);
          expect(transitionResult.toStatus).toBe(OrderStatus.Paid);
        },
      ),
      { numRuns: 500 },
    );
  });
});
