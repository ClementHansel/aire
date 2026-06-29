import { describe, it, expect, beforeEach } from 'vitest';
import { OrderStatus, ORDER_STATUS_TRANSITIONS, ERR_ORDER_INVALID_TRANSITION } from '@aire/shared';
import { OrderStateMachine, TransitionResult, StatusLogEntry } from './order-state-machine';

describe('OrderStateMachine', () => {
  let stateMachine: OrderStateMachine;

  beforeEach(() => {
    stateMachine = new OrderStateMachine();
  });

  describe('canTransition', () => {
    it('should allow ordered → paid', () => {
      expect(stateMachine.canTransition(OrderStatus.Ordered, OrderStatus.Paid)).toBe(true);
    });

    it('should allow ordered → cancelled', () => {
      expect(stateMachine.canTransition(OrderStatus.Ordered, OrderStatus.Cancelled)).toBe(true);
    });

    it('should allow paid → confirmed', () => {
      expect(stateMachine.canTransition(OrderStatus.Paid, OrderStatus.Confirmed)).toBe(true);
    });

    it('should allow paid → cancelled', () => {
      expect(stateMachine.canTransition(OrderStatus.Paid, OrderStatus.Cancelled)).toBe(true);
    });

    it('should allow confirmed → completed', () => {
      expect(stateMachine.canTransition(OrderStatus.Confirmed, OrderStatus.Completed)).toBe(true);
    });

    it('should reject ordered → completed (skipping states)', () => {
      expect(stateMachine.canTransition(OrderStatus.Ordered, OrderStatus.Completed)).toBe(false);
    });

    it('should reject ordered → confirmed (skipping states)', () => {
      expect(stateMachine.canTransition(OrderStatus.Ordered, OrderStatus.Confirmed)).toBe(false);
    });

    it('should reject paid → completed (skipping states)', () => {
      expect(stateMachine.canTransition(OrderStatus.Paid, OrderStatus.Completed)).toBe(false);
    });

    it('should reject paid → ordered (backward transition)', () => {
      expect(stateMachine.canTransition(OrderStatus.Paid, OrderStatus.Ordered)).toBe(false);
    });

    it('should reject completed → any (terminal state)', () => {
      expect(stateMachine.canTransition(OrderStatus.Completed, OrderStatus.Ordered)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Completed, OrderStatus.Paid)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Completed, OrderStatus.Confirmed)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Completed, OrderStatus.Cancelled)).toBe(false);
    });

    it('should reject cancelled → any (terminal state)', () => {
      expect(stateMachine.canTransition(OrderStatus.Cancelled, OrderStatus.Ordered)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Cancelled, OrderStatus.Paid)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Cancelled, OrderStatus.Confirmed)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Cancelled, OrderStatus.Completed)).toBe(false);
    });

    it('should reject self-transitions', () => {
      expect(stateMachine.canTransition(OrderStatus.Ordered, OrderStatus.Ordered)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Paid, OrderStatus.Paid)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Confirmed, OrderStatus.Confirmed)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Completed, OrderStatus.Completed)).toBe(false);
      expect(stateMachine.canTransition(OrderStatus.Cancelled, OrderStatus.Cancelled)).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('should return [paid, cancelled] for ordered', () => {
      const result = stateMachine.getValidTransitions(OrderStatus.Ordered);
      expect(result).toEqual([OrderStatus.Paid, OrderStatus.Cancelled]);
    });

    it('should return [confirmed, cancelled] for paid', () => {
      const result = stateMachine.getValidTransitions(OrderStatus.Paid);
      expect(result).toEqual([OrderStatus.Confirmed, OrderStatus.Cancelled]);
    });

    it('should return [completed] for confirmed', () => {
      const result = stateMachine.getValidTransitions(OrderStatus.Confirmed);
      expect(result).toEqual([OrderStatus.Completed]);
    });

    it('should return empty array for completed (terminal)', () => {
      const result = stateMachine.getValidTransitions(OrderStatus.Completed);
      expect(result).toEqual([]);
    });

    it('should return empty array for cancelled (terminal)', () => {
      const result = stateMachine.getValidTransitions(OrderStatus.Cancelled);
      expect(result).toEqual([]);
    });

    it('should return a new array (not a reference to the internal constant)', () => {
      const result1 = stateMachine.getValidTransitions(OrderStatus.Ordered);
      const result2 = stateMachine.getValidTransitions(OrderStatus.Ordered);
      expect(result1).toEqual(result2);
      expect(result1).not.toBe(result2);
    });
  });

  describe('transition', () => {
    describe('valid transitions', () => {
      it('should succeed for ordered → paid', () => {
        const result = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Paid);
        expect(result).toEqual<TransitionResult>({
          success: true,
          fromStatus: OrderStatus.Ordered,
          toStatus: OrderStatus.Paid,
        });
      });

      it('should succeed for ordered → cancelled', () => {
        const result = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Cancelled);
        expect(result).toEqual<TransitionResult>({
          success: true,
          fromStatus: OrderStatus.Ordered,
          toStatus: OrderStatus.Cancelled,
        });
      });

      it('should succeed for paid → confirmed', () => {
        const result = stateMachine.transition(OrderStatus.Paid, OrderStatus.Confirmed);
        expect(result).toEqual<TransitionResult>({
          success: true,
          fromStatus: OrderStatus.Paid,
          toStatus: OrderStatus.Confirmed,
        });
      });

      it('should succeed for paid → cancelled', () => {
        const result = stateMachine.transition(OrderStatus.Paid, OrderStatus.Cancelled);
        expect(result).toEqual<TransitionResult>({
          success: true,
          fromStatus: OrderStatus.Paid,
          toStatus: OrderStatus.Cancelled,
        });
      });

      it('should succeed for confirmed → completed', () => {
        const result = stateMachine.transition(OrderStatus.Confirmed, OrderStatus.Completed);
        expect(result).toEqual<TransitionResult>({
          success: true,
          fromStatus: OrderStatus.Confirmed,
          toStatus: OrderStatus.Completed,
        });
      });
    });

    describe('invalid transitions', () => {
      it('should fail with descriptive error for ordered → completed', () => {
        const result = stateMachine.transition(OrderStatus.Ordered, OrderStatus.Completed);
        expect(result.success).toBe(false);
        expect(result.fromStatus).toBe(OrderStatus.Ordered);
        expect(result.toStatus).toBe(OrderStatus.Completed);
        expect(result.error).toBe(
          "Cannot transition from 'ordered' to 'completed'. Valid transitions: paid, cancelled",
        );
        expect(result.errorCode).toBe(ERR_ORDER_INVALID_TRANSITION);
      });

      it('should fail with descriptive error for completed → paid (terminal state)', () => {
        const result = stateMachine.transition(OrderStatus.Completed, OrderStatus.Paid);
        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Cannot transition from 'completed' to 'paid'. Valid transitions: none",
        );
        expect(result.errorCode).toBe(ERR_ORDER_INVALID_TRANSITION);
      });

      it('should fail with descriptive error for cancelled → ordered (terminal state)', () => {
        const result = stateMachine.transition(OrderStatus.Cancelled, OrderStatus.Ordered);
        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Cannot transition from 'cancelled' to 'ordered'. Valid transitions: none",
        );
        expect(result.errorCode).toBe(ERR_ORDER_INVALID_TRANSITION);
      });

      it('should fail for paid → ordered (backward)', () => {
        const result = stateMachine.transition(OrderStatus.Paid, OrderStatus.Ordered);
        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Cannot transition from 'paid' to 'ordered'. Valid transitions: confirmed, cancelled",
        );
      });

      it('should fail for confirmed → paid (backward)', () => {
        const result = stateMachine.transition(OrderStatus.Confirmed, OrderStatus.Paid);
        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Cannot transition from 'confirmed' to 'paid'. Valid transitions: completed",
        );
      });
    });
  });

  describe('createLogEntry', () => {
    it('should create a status log entry with all required fields', () => {
      const before = new Date();
      const entry = stateMachine.createLogEntry(
        'order-123',
        OrderStatus.Ordered,
        OrderStatus.Paid,
        'operator-456',
      );
      const after = new Date();

      expect(entry).toEqual<StatusLogEntry>({
        orderId: 'order-123',
        fromStatus: OrderStatus.Ordered,
        toStatus: OrderStatus.Paid,
        operatorId: 'operator-456',
        timestamp: expect.any(Date),
      });
      expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should create entries with current timestamp', () => {
      const entry1 = stateMachine.createLogEntry(
        'order-1',
        OrderStatus.Paid,
        OrderStatus.Confirmed,
        'op-1',
      );
      const entry2 = stateMachine.createLogEntry(
        'order-1',
        OrderStatus.Confirmed,
        OrderStatus.Completed,
        'op-1',
      );

      expect(entry2.timestamp.getTime()).toBeGreaterThanOrEqual(entry1.timestamp.getTime());
    });
  });
});
