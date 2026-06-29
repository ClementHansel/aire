import { OrderStatus, ORDER_STATUS_TRANSITIONS, ERR_ORDER_INVALID_TRANSITION } from '@aire/shared';

/**
 * Result of a state transition attempt.
 */
export interface TransitionResult {
  success: boolean;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  error?: string;
  errorCode?: string;
}

/**
 * Entry recording a status transition in the order status log.
 */
export interface StatusLogEntry {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  operatorId: string;
  timestamp: Date;
}

/**
 * Order state machine that validates and performs status transitions.
 * Uses the ORDER_STATUS_TRANSITIONS constant from @aire/shared as the
 * single source of truth for valid transitions.
 */
export class OrderStateMachine {
  /**
   * Checks whether a transition from currentStatus to targetStatus is allowed.
   */
  canTransition(currentStatus: OrderStatus, targetStatus: OrderStatus): boolean {
    const validTargets = ORDER_STATUS_TRANSITIONS[currentStatus];
    return validTargets.includes(targetStatus);
  }

  /**
   * Returns the list of valid target statuses for the given current status.
   */
  getValidTransitions(currentStatus: OrderStatus): OrderStatus[] {
    return [...ORDER_STATUS_TRANSITIONS[currentStatus]];
  }

  /**
   * Attempts a state transition. Returns a result indicating success or failure.
   * On failure, includes a descriptive error message and the error code.
   */
  transition(currentStatus: OrderStatus, targetStatus: OrderStatus): TransitionResult {
    if (this.canTransition(currentStatus, targetStatus)) {
      return {
        success: true,
        fromStatus: currentStatus,
        toStatus: targetStatus,
      };
    }

    const validTargets = this.getValidTransitions(currentStatus);
    const validTransitionsText =
      validTargets.length > 0 ? validTargets.join(', ') : 'none';

    return {
      success: false,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      error: `Cannot transition from '${currentStatus}' to '${targetStatus}'. Valid transitions: ${validTransitionsText}`,
      errorCode: ERR_ORDER_INVALID_TRANSITION,
    };
  }

  /**
   * Creates a status log entry for a successful transition.
   * Call this after a successful transition to record the change.
   */
  createLogEntry(
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    operatorId: string,
  ): StatusLogEntry {
    return {
      orderId,
      fromStatus,
      toStatus,
      operatorId,
      timestamp: new Date(),
    };
  }
}
