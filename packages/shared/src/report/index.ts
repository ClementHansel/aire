import { OrderStatus, PaymentMethod } from '../enums';

/**
 * Represents an order record for report aggregation purposes.
 * Contains only the fields needed for computing summary statistics.
 */
export interface OrderForReport {
  status: OrderStatus;
  total: number;
  paymentMethod: PaymentMethod | null;
  membershipId: string | null;
  customerId: string | null;
}

/**
 * Result of aggregating orders into a report summary.
 */
export interface AggregationResult {
  /** Total number of orders regardless of status */
  totalOrders: number;
  /** Sum of totals for orders with status in (paid, confirmed, completed) */
  revenue: number;
  /** Count of orders with status in (paid, confirmed, completed) */
  paidCount: number;
  /** Count of orders with status = cancelled */
  cancelledCount: number;
  /** Revenue breakdown by payment method */
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
}

/**
 * Statuses that count towards revenue (paid, confirmed, completed).
 */
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.Paid,
  OrderStatus.Confirmed,
  OrderStatus.Completed,
];

/**
 * Pure function that aggregates a set of orders into summary report statistics.
 *
 * - totalOrders = total count of all orders
 * - revenue = sum of `total` for orders with status in (paid, confirmed, completed)
 * - paidCount = count of orders with status in (paid, confirmed, completed)
 * - cancelledCount = count of orders with status = cancelled
 * - byPaymentMethod = breakdown of revenue and count per payment method
 *   (only for revenue-contributing orders with a non-null payment method)
 *
 * Requirements: 23.1, 23.2
 */
export function aggregateOrders(orders: OrderForReport[]): AggregationResult {
  let revenue = 0;
  let paidCount = 0;
  let cancelledCount = 0;
  const byPaymentMethod: Record<string, { revenue: number; count: number }> = {};

  for (const order of orders) {
    if (REVENUE_STATUSES.includes(order.status)) {
      revenue += order.total;
      paidCount++;

      if (order.paymentMethod !== null) {
        if (!byPaymentMethod[order.paymentMethod]) {
          byPaymentMethod[order.paymentMethod] = { revenue: 0, count: 0 };
        }
        const entry = byPaymentMethod[order.paymentMethod]!;
        entry.revenue += order.total;
        entry.count++;
      }
    }

    if (order.status === OrderStatus.Cancelled) {
      cancelledCount++;
    }
  }

  return {
    totalOrders: orders.length,
    revenue,
    paidCount,
    cancelledCount,
    byPaymentMethod,
  };
}
