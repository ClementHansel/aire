/**
 * Void reversal logic for the AIRE Operations Platform.
 *
 * Pure logic module that determines what operations need to be performed
 * when an order is voided. All operations should be executed within a single
 * database transaction by the backend service layer.
 *
 * Operations:
 * - Transition order to CANCELLED status
 * - Reverse membership usages (set reversed=true)
 * - Restore voucher codes to 'active' status
 * - Cancel membership activated by the voided order
 * - Revert customer type tags (remove all tags for the order)
 * - Display warning for paid orders: refund must be issued separately
 * - Record audit entry: operator, reason, timestamp, PIN usage
 *
 * Requirements: 21.4, 21.5, 21.6, 22.3
 */

import { OrderStatus } from '../enums';

/**
 * Represents the order data needed to plan a void reversal.
 */
export interface OrderForVoid {
  /** Order ID */
  id: string;
  /** Current order status */
  status: OrderStatus;
  /** Whether the order has membership usages recorded against it */
  hasMembershipUsages: boolean;
  /** Whether the order redeemed any voucher codes */
  hasVoucherRedemptions: boolean;
  /** Whether the order activated a new membership */
  hasActivatedMembership: boolean;
  /** The membership ID activated by this order (if any) */
  membershipId?: string;
}

/**
 * Audit entry recorded with every void operation.
 */
export interface VoidAuditEntry {
  /** ID of the operator performing the void */
  operatorId: string;
  /** Reason for the void */
  reason: string;
  /** Whether an admin PIN was used for authorization */
  pinUsed: boolean;
  /** ISO timestamp of when the void was performed */
  timestamp: string;
}

/**
 * Complete plan of all operations that need to be executed during a void.
 * All operations should be performed within a single database transaction.
 */
export interface VoidReversalPlan {
  /** Order ID being voided */
  orderId: string;
  /** Target status — always 'cancelled' */
  transitionTo: 'cancelled';
  /** Whether membership usages should be reversed (set reversed=true, reversed_at) */
  reverseMembershipUsages: boolean;
  /** Whether voucher codes should be restored to 'active' status */
  restoreVoucherCodes: boolean;
  /** Whether the membership activated by this order should be cancelled */
  cancelActivatedMembership: boolean;
  /** The membership ID to cancel (only set if cancelActivatedMembership is true) */
  membershipIdToCancel?: string;
  /** Whether customer type tags should be reverted (always true on void) */
  revertTags: boolean;
  /** Whether to show the paid order warning to the operator */
  showPaidWarning: boolean;
  /** Warning message to display (only set if showPaidWarning is true) */
  paidWarningMessage?: string;
  /** Audit entry to record with this void */
  auditEntry: VoidAuditEntry;
}

/**
 * Order statuses that indicate payment was already collected.
 * When voiding orders in these statuses, a warning is shown that
 * refund must be issued separately.
 */
const PAID_STATUSES: readonly OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
];

/**
 * Warning message displayed when voiding a paid order.
 */
export const VOID_PAID_WARNING_MESSAGE =
  'Payment already collected — this voids the record only; refund must be issued separately.';

/**
 * Plans the void reversal operations for an order.
 *
 * This is a pure function that determines what operations need to occur
 * based on the order's current state. The actual execution of these
 * operations (database writes) is handled by the backend service layer
 * within a single transaction.
 *
 * @param order - The order data needed for planning
 * @param operatorId - ID of the operator performing the void
 * @param reason - Reason for the void
 * @param pinUsed - Whether an admin PIN was used for authorization
 * @returns A complete plan of operations to execute
 */
export function planVoidReversal(
  order: OrderForVoid,
  operatorId: string,
  reason: string,
  pinUsed: boolean,
): VoidReversalPlan {
  const showPaidWarning = PAID_STATUSES.includes(order.status);
  const cancelActivatedMembership =
    order.hasActivatedMembership && order.membershipId !== undefined;

  return {
    orderId: order.id,
    transitionTo: 'cancelled',
    reverseMembershipUsages: order.hasMembershipUsages,
    restoreVoucherCodes: order.hasVoucherRedemptions,
    cancelActivatedMembership,
    membershipIdToCancel: cancelActivatedMembership ? order.membershipId : undefined,
    revertTags: true,
    showPaidWarning,
    paidWarningMessage: showPaidWarning ? VOID_PAID_WARNING_MESSAGE : undefined,
    auditEntry: {
      operatorId,
      reason,
      pinUsed,
      timestamp: new Date().toISOString(),
    },
  };
}
