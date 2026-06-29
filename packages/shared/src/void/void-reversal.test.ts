import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  planVoidReversal,
  VOID_PAID_WARNING_MESSAGE,
  OrderForVoid,
  VoidReversalPlan,
} from './void-reversal';
import { OrderStatus } from '../enums';

describe('planVoidReversal', () => {
  const baseOrder: OrderForVoid = {
    id: 'order-001',
    status: OrderStatus.Paid,
    hasMembershipUsages: false,
    hasVoucherRedemptions: false,
    hasActivatedMembership: false,
  };

  const operatorId = 'operator-123';
  const reason = 'Customer changed mind';
  const pinUsed = true;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status transition', () => {
    it('should always transition to cancelled', () => {
      const plan = planVoidReversal(baseOrder, operatorId, reason, pinUsed);
      expect(plan.transitionTo).toBe('cancelled');
    });

    it('should include the correct orderId', () => {
      const plan = planVoidReversal(baseOrder, operatorId, reason, pinUsed);
      expect(plan.orderId).toBe('order-001');
    });
  });

  describe('membership usage reversal', () => {
    it('should set reverseMembershipUsages=true when order has membership usages', () => {
      const order: OrderForVoid = { ...baseOrder, hasMembershipUsages: true };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.reverseMembershipUsages).toBe(true);
    });

    it('should set reverseMembershipUsages=false when order has no membership usages', () => {
      const order: OrderForVoid = { ...baseOrder, hasMembershipUsages: false };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.reverseMembershipUsages).toBe(false);
    });
  });

  describe('voucher code restoration', () => {
    it('should set restoreVoucherCodes=true when order has voucher redemptions', () => {
      const order: OrderForVoid = { ...baseOrder, hasVoucherRedemptions: true };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.restoreVoucherCodes).toBe(true);
    });

    it('should set restoreVoucherCodes=false when order has no voucher redemptions', () => {
      const order: OrderForVoid = { ...baseOrder, hasVoucherRedemptions: false };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.restoreVoucherCodes).toBe(false);
    });
  });

  describe('membership cancellation', () => {
    it('should cancel activated membership when order activated one with membershipId', () => {
      const order: OrderForVoid = {
        ...baseOrder,
        hasActivatedMembership: true,
        membershipId: 'membership-abc',
      };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.cancelActivatedMembership).toBe(true);
      expect(plan.membershipIdToCancel).toBe('membership-abc');
    });

    it('should not cancel membership when order did not activate one', () => {
      const order: OrderForVoid = {
        ...baseOrder,
        hasActivatedMembership: false,
      };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.cancelActivatedMembership).toBe(false);
      expect(plan.membershipIdToCancel).toBeUndefined();
    });

    it('should not cancel membership when hasActivatedMembership is true but membershipId is missing', () => {
      const order: OrderForVoid = {
        ...baseOrder,
        hasActivatedMembership: true,
        membershipId: undefined,
      };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.cancelActivatedMembership).toBe(false);
      expect(plan.membershipIdToCancel).toBeUndefined();
    });
  });

  describe('customer type tag reversion', () => {
    it('should always set revertTags=true', () => {
      const plan = planVoidReversal(baseOrder, operatorId, reason, pinUsed);
      expect(plan.revertTags).toBe(true);
    });

    it('should revert tags regardless of order status', () => {
      const statuses = [
        OrderStatus.Ordered,
        OrderStatus.Paid,
        OrderStatus.Confirmed,
        OrderStatus.Completed,
      ];
      for (const status of statuses) {
        const order: OrderForVoid = { ...baseOrder, status };
        const plan = planVoidReversal(order, operatorId, reason, pinUsed);
        expect(plan.revertTags).toBe(true);
      }
    });
  });

  describe('paid order warning', () => {
    it('should show paid warning when status is "paid"', () => {
      const order: OrderForVoid = { ...baseOrder, status: OrderStatus.Paid };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.showPaidWarning).toBe(true);
      expect(plan.paidWarningMessage).toBe(VOID_PAID_WARNING_MESSAGE);
    });

    it('should show paid warning when status is "confirmed"', () => {
      const order: OrderForVoid = { ...baseOrder, status: OrderStatus.Confirmed };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.showPaidWarning).toBe(true);
      expect(plan.paidWarningMessage).toBe(VOID_PAID_WARNING_MESSAGE);
    });

    it('should show paid warning when status is "completed"', () => {
      const order: OrderForVoid = { ...baseOrder, status: OrderStatus.Completed };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.showPaidWarning).toBe(true);
      expect(plan.paidWarningMessage).toBe(VOID_PAID_WARNING_MESSAGE);
    });

    it('should NOT show paid warning when status is "ordered"', () => {
      const order: OrderForVoid = { ...baseOrder, status: OrderStatus.Ordered };
      const plan = planVoidReversal(order, operatorId, reason, pinUsed);
      expect(plan.showPaidWarning).toBe(false);
      expect(plan.paidWarningMessage).toBeUndefined();
    });

    it('should contain the correct warning message text', () => {
      expect(VOID_PAID_WARNING_MESSAGE).toBe(
        'Payment already collected — this voids the record only; refund must be issued separately.',
      );
    });
  });

  describe('audit entry', () => {
    it('should record the operator ID', () => {
      const plan = planVoidReversal(baseOrder, operatorId, reason, pinUsed);
      expect(plan.auditEntry.operatorId).toBe(operatorId);
    });

    it('should record the reason', () => {
      const plan = planVoidReversal(baseOrder, operatorId, reason, pinUsed);
      expect(plan.auditEntry.reason).toBe(reason);
    });

    it('should record whether PIN was used', () => {
      const planWithPin = planVoidReversal(baseOrder, operatorId, reason, true);
      expect(planWithPin.auditEntry.pinUsed).toBe(true);

      const planWithoutPin = planVoidReversal(baseOrder, operatorId, reason, false);
      expect(planWithoutPin.auditEntry.pinUsed).toBe(false);
    });

    it('should record a valid ISO timestamp', () => {
      const plan = planVoidReversal(baseOrder, operatorId, reason, pinUsed);
      expect(plan.auditEntry.timestamp).toBe('2024-06-15T10:30:00.000Z');
      // Verify it's a valid date
      const date = new Date(plan.auditEntry.timestamp);
      expect(date.toISOString()).toBe(plan.auditEntry.timestamp);
    });
  });

  describe('full reversal scenarios', () => {
    it('should plan full reversal for a paid order with all associations', () => {
      const order: OrderForVoid = {
        id: 'order-full',
        status: OrderStatus.Paid,
        hasMembershipUsages: true,
        hasVoucherRedemptions: true,
        hasActivatedMembership: true,
        membershipId: 'mem-001',
      };
      const plan = planVoidReversal(order, 'op-1', 'Duplicate order', true);

      expect(plan.orderId).toBe('order-full');
      expect(plan.transitionTo).toBe('cancelled');
      expect(plan.reverseMembershipUsages).toBe(true);
      expect(plan.restoreVoucherCodes).toBe(true);
      expect(plan.cancelActivatedMembership).toBe(true);
      expect(plan.membershipIdToCancel).toBe('mem-001');
      expect(plan.revertTags).toBe(true);
      expect(plan.showPaidWarning).toBe(true);
      expect(plan.paidWarningMessage).toBe(VOID_PAID_WARNING_MESSAGE);
      expect(plan.auditEntry.operatorId).toBe('op-1');
      expect(plan.auditEntry.reason).toBe('Duplicate order');
      expect(plan.auditEntry.pinUsed).toBe(true);
    });

    it('should plan minimal reversal for a new unpaid order with no associations', () => {
      const order: OrderForVoid = {
        id: 'order-simple',
        status: OrderStatus.Ordered,
        hasMembershipUsages: false,
        hasVoucherRedemptions: false,
        hasActivatedMembership: false,
      };
      const plan = planVoidReversal(order, 'op-2', 'Wrong customer', false);

      expect(plan.orderId).toBe('order-simple');
      expect(plan.transitionTo).toBe('cancelled');
      expect(plan.reverseMembershipUsages).toBe(false);
      expect(plan.restoreVoucherCodes).toBe(false);
      expect(plan.cancelActivatedMembership).toBe(false);
      expect(plan.membershipIdToCancel).toBeUndefined();
      expect(plan.revertTags).toBe(true);
      expect(plan.showPaidWarning).toBe(false);
      expect(plan.paidWarningMessage).toBeUndefined();
      expect(plan.auditEntry.operatorId).toBe('op-2');
      expect(plan.auditEntry.reason).toBe('Wrong customer');
      expect(plan.auditEntry.pinUsed).toBe(false);
    });

    it('should plan reversal for a confirmed order with membership usage only', () => {
      const order: OrderForVoid = {
        id: 'order-member',
        status: OrderStatus.Confirmed,
        hasMembershipUsages: true,
        hasVoucherRedemptions: false,
        hasActivatedMembership: false,
      };
      const plan = planVoidReversal(order, 'op-3', 'Service not delivered', true);

      expect(plan.reverseMembershipUsages).toBe(true);
      expect(plan.restoreVoucherCodes).toBe(false);
      expect(plan.cancelActivatedMembership).toBe(false);
      expect(plan.showPaidWarning).toBe(true);
    });

    it('should plan reversal for an order with voucher redemption only', () => {
      const order: OrderForVoid = {
        id: 'order-voucher',
        status: OrderStatus.Paid,
        hasMembershipUsages: false,
        hasVoucherRedemptions: true,
        hasActivatedMembership: false,
      };
      const plan = planVoidReversal(order, 'op-4', 'Voucher applied wrongly', true);

      expect(plan.reverseMembershipUsages).toBe(false);
      expect(plan.restoreVoucherCodes).toBe(true);
      expect(plan.cancelActivatedMembership).toBe(false);
      expect(plan.showPaidWarning).toBe(true);
    });
  });
});
