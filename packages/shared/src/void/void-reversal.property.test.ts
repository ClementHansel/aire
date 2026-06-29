import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { planVoidReversal, OrderForVoid } from './void-reversal';
import { OrderStatus } from '../enums';

/**
 * Property-based tests for void reversal completeness.
 *
 * **Validates: Requirements 21.5, 22.3**
 */

// --- Arbitrary Generators ---

/**
 * All voidable order statuses (excludes 'cancelled' as you can't void an already-cancelled order).
 */
const VOIDABLE_STATUSES: OrderStatus[] = [
  OrderStatus.Ordered,
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
];

/**
 * Statuses that indicate payment has been collected.
 */
const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
];

/**
 * Generates an arbitrary OrderStatus from the voidable set.
 */
const arbVoidableStatus: fc.Arbitrary<OrderStatus> = fc.constantFrom(...VOIDABLE_STATUSES);

/**
 * Generates an arbitrary OrderForVoid with realistic combinations.
 * When hasActivatedMembership is true, membershipId may or may not be defined.
 */
const arbOrderForVoid: fc.Arbitrary<OrderForVoid> = fc.record({
  id: fc.uuid(),
  status: arbVoidableStatus,
  hasMembershipUsages: fc.boolean(),
  hasVoucherRedemptions: fc.boolean(),
  hasActivatedMembership: fc.boolean(),
  membershipId: fc.option(fc.uuid(), { nil: undefined }),
});

/**
 * Generates a non-empty operator ID string.
 */
const arbOperatorId: fc.Arbitrary<string> = fc.uuid();

/**
 * Generates a non-empty reason string.
 */
const arbReason: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Generates a boolean for pin usage.
 */
const arbPinUsed: fc.Arbitrary<boolean> = fc.boolean();

describe('Void Reversal Completeness - Property-Based Tests', () => {
  describe('Property 14: Void Reversal Completeness', () => {
    it('always cancels: transitionTo is always "cancelled" regardless of input', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);
          expect(plan.transitionTo).toBe('cancelled');
        }),
        { numRuns: 500 },
      );
    });

    it('membership reversal completeness: reverseMembershipUsages === hasMembershipUsages', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);
          expect(plan.reverseMembershipUsages).toBe(order.hasMembershipUsages);
        }),
        { numRuns: 500 },
      );
    });

    it('voucher restoration completeness: restoreVoucherCodes === hasVoucherRedemptions', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);
          expect(plan.restoreVoucherCodes).toBe(order.hasVoucherRedemptions);
        }),
        { numRuns: 500 },
      );
    });

    it('membership cancellation: cancelActivatedMembership === (hasActivatedMembership AND membershipId is defined)', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);
          const expectedCancel = order.hasActivatedMembership && order.membershipId !== undefined;
          expect(plan.cancelActivatedMembership).toBe(expectedCancel);

          // When cancelling, the membership ID must be provided
          if (expectedCancel) {
            expect(plan.membershipIdToCancel).toBe(order.membershipId);
          } else {
            expect(plan.membershipIdToCancel).toBeUndefined();
          }
        }),
        { numRuns: 500 },
      );
    });

    it('tags always reverted: revertTags is always true', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);
          expect(plan.revertTags).toBe(true);
        }),
        { numRuns: 500 },
      );
    });

    it('audit always present: auditEntry always contains operatorId, reason, pinUsed, and valid timestamp', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);

          // Audit entry fields match input
          expect(plan.auditEntry.operatorId).toBe(operatorId);
          expect(plan.auditEntry.reason).toBe(reason);
          expect(plan.auditEntry.pinUsed).toBe(pinUsed);

          // Timestamp is a valid ISO string
          const timestamp = plan.auditEntry.timestamp;
          expect(timestamp).toBeDefined();
          expect(typeof timestamp).toBe('string');
          const parsed = new Date(timestamp);
          expect(parsed.toISOString()).toBe(timestamp);
          expect(Number.isNaN(parsed.getTime())).toBe(false);
        }),
        { numRuns: 500 },
      );
    });

    it('paid warning correctness: showPaidWarning is true iff status is paid/confirmed/completed', () => {
      fc.assert(
        fc.property(arbOrderForVoid, arbOperatorId, arbReason, arbPinUsed, (order, operatorId, reason, pinUsed) => {
          const plan = planVoidReversal(order, operatorId, reason, pinUsed);
          const isPaidStatus = PAID_STATUSES.includes(order.status);

          expect(plan.showPaidWarning).toBe(isPaidStatus);

          // Warning message should be present iff showPaidWarning is true
          if (isPaidStatus) {
            expect(plan.paidWarningMessage).toBeDefined();
            expect(typeof plan.paidWarningMessage).toBe('string');
            expect(plan.paidWarningMessage!.length).toBeGreaterThan(0);
          } else {
            expect(plan.paidWarningMessage).toBeUndefined();
          }
        }),
        { numRuns: 500 },
      );
    });
  });
});
