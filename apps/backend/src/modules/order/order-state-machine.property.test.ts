import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OrderStatus, ORDER_STATUS_TRANSITIONS } from '@aire/shared';
import { OrderStateMachine } from './order-state-machine';

/**
 * Property-Based Tests: Order State Machine Validity
 *
 * **Validates: Requirements 37.1, 37.2, 37.3, 20.1**
 *
 * Property 8: For any order in state S, transition to T succeeds iff (S,T)
 * is in the valid set. Invalid transitions rejected. Every success produces
 * audit record.
 */

const ALL_STATUSES = [
  OrderStatus.Ordered,
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
  OrderStatus.Cancelled,
] as const;

const TERMINAL_STATUSES = [OrderStatus.Completed, OrderStatus.Cancelled] as const;

/**
 * Generator: produces any OrderStatus value.
 */
const orderStatusArb = fc.constantFrom(...ALL_STATUSES);

/**
 * Generator: produces a pair of (fromStatus, toStatus) covering
 * all 25 combinations of status pairs.
 */
const statusPairArb = fc.tuple(orderStatusArb, orderStatusArb);

describe('Property 8: Order State Machine Validity', () => {
  const stateMachine = new OrderStateMachine();

  it('biconditional validity: transition(S, T).success === true iff (S,T) is in ORDER_STATUS_TRANSITIONS[S]', () => {
    fc.assert(
      fc.property(statusPairArb, ([fromStatus, toStatus]) => {
        const result = stateMachine.transition(fromStatus, toStatus);
        const isValid = ORDER_STATUS_TRANSITIONS[fromStatus].includes(toStatus);

        expect(result.success).toBe(isValid);
        expect(result.fromStatus).toBe(fromStatus);
        expect(result.toStatus).toBe(toStatus);
      }),
      { numRuns: 500 },
    );
  });

  it('error on rejection: every failed transition has error message containing current state and valid transitions info', () => {
    fc.assert(
      fc.property(statusPairArb, ([fromStatus, toStatus]) => {
        const result = stateMachine.transition(fromStatus, toStatus);

        if (!result.success) {
          // Error message must exist
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe('string');

          // Error message must reference the current state
          expect(result.error).toContain(fromStatus);

          // Error message must reference the target state
          expect(result.error).toContain(toStatus);

          // Error message must mention valid transitions or 'none'
          const validTargets = ORDER_STATUS_TRANSITIONS[fromStatus];
          if (validTargets.length === 0) {
            expect(result.error).toContain('none');
          } else {
            // At least one valid target should be mentioned
            const mentionsValidTarget = validTargets.some((t) =>
              result.error!.includes(t),
            );
            expect(mentionsValidTarget).toBe(true);
          }

          // Error code must be present
          expect(result.errorCode).toBeDefined();
          expect(typeof result.errorCode).toBe('string');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('audit record production: every successful transition can produce a valid StatusLogEntry via createLogEntry', () => {
    const orderIdArb = fc.uuid();
    const operatorIdArb = fc.uuid();

    fc.assert(
      fc.property(
        statusPairArb,
        orderIdArb,
        operatorIdArb,
        ([fromStatus, toStatus], orderId, operatorId) => {
          const result = stateMachine.transition(fromStatus, toStatus);

          if (result.success) {
            const logEntry = stateMachine.createLogEntry(
              orderId,
              fromStatus,
              toStatus,
              operatorId,
            );

            // Log entry must have all required fields
            expect(logEntry.orderId).toBe(orderId);
            expect(logEntry.fromStatus).toBe(fromStatus);
            expect(logEntry.toStatus).toBe(toStatus);
            expect(logEntry.operatorId).toBe(operatorId);
            expect(logEntry.timestamp).toBeInstanceOf(Date);

            // Timestamp must be recent (within last second)
            const now = new Date();
            expect(logEntry.timestamp.getTime()).toBeLessThanOrEqual(now.getTime());
            expect(logEntry.timestamp.getTime()).toBeGreaterThanOrEqual(
              now.getTime() - 1000,
            );
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('terminal states: completed and cancelled have NO valid transitions (for any T, canTransition(terminal, T) === false)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_STATUSES),
        orderStatusArb,
        (terminalStatus, targetStatus) => {
          expect(stateMachine.canTransition(terminalStatus, targetStatus)).toBe(false);
          expect(stateMachine.getValidTransitions(terminalStatus)).toEqual([]);

          const result = stateMachine.transition(terminalStatus, targetStatus);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('no self-transitions: for any S, canTransition(S, S) === false', () => {
    fc.assert(
      fc.property(orderStatusArb, (status) => {
        expect(stateMachine.canTransition(status, status)).toBe(false);

        const result = stateMachine.transition(status, status);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('exhaustive coverage: all 25 state pairs (5×5) produce correct results', () => {
    // This test deterministically checks all 25 combinations
    for (const fromStatus of ALL_STATUSES) {
      for (const toStatus of ALL_STATUSES) {
        const result = stateMachine.transition(fromStatus, toStatus);
        const isValid = ORDER_STATUS_TRANSITIONS[fromStatus].includes(toStatus);

        expect(result.success).toBe(isValid);
        expect(result.fromStatus).toBe(fromStatus);
        expect(result.toStatus).toBe(toStatus);

        if (isValid) {
          // Successful transitions should NOT have error fields
          expect(result.error).toBeUndefined();
          expect(result.errorCode).toBeUndefined();
        } else {
          // Failed transitions MUST have error fields
          expect(result.error).toBeDefined();
          expect(result.errorCode).toBeDefined();
        }
      }
    }
  });
});
