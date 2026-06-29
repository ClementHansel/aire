/**
 * Employee management module for the AIRE Operations Platform.
 *
 * Pure logic (no DB) for:
 * - Commission calculation (percentage, per-order fixed, tiered)
 * - Clock-in/clock-out shift tracking interfaces
 * - Operator performance metrics interfaces
 * - Shift scheduling interfaces
 *
 * Requirements: 29.1, 29.2, 29.3, 29.4
 */

// ─── Commission Calculation ──────────────────────────────────────────────────

/**
 * Commission rule types configurable per operator/outlet.
 * - percentage: commission = totalRevenue * value (e.g., 0.05 = 5%)
 * - per_order: commission = ordersConsidered * value (e.g., 5000 per order)
 * - tiered: find the tier where totalRevenue >= tier.minRevenue (highest applicable tier), apply that tier's percentage
 */
export type CommissionRule =
  | { type: 'percentage'; value: number }
  | { type: 'per_order'; value: number }
  | { type: 'tiered'; tiers: Array<{ minRevenue: number; percentage: number }> };

/**
 * Input for commission calculation.
 */
export interface CommissionInput {
  rule: CommissionRule;
  completedOrders: Array<{ total: number; isVoided: boolean }>;
}

/**
 * Result of a commission calculation.
 */
export interface CommissionResult {
  totalCommission: number;
  ordersConsidered: number; // excludes voided
  totalRevenue: number; // from non-voided orders
}

/**
 * Calculates commission for an operator based on their commission rule and completed orders.
 *
 * Logic:
 * 1. Filter out voided orders (isVoided === true)
 * 2. Calculate totalRevenue from non-voided orders
 * 3. Apply commission rule:
 *    - percentage: commission = totalRevenue * rule.value
 *    - per_order: commission = ordersConsidered * rule.value
 *    - tiered: find highest applicable tier (totalRevenue >= tier.minRevenue), apply that tier's percentage
 *
 * @param input - Commission calculation input with rule and orders
 * @returns CommissionResult with totalCommission, ordersConsidered, and totalRevenue
 */
export function calculateCommission(input: CommissionInput): CommissionResult {
  const { rule, completedOrders } = input;

  // 1. Filter out voided orders
  const nonVoidedOrders = completedOrders.filter((order) => !order.isVoided);
  const ordersConsidered = nonVoidedOrders.length;

  // 2. Calculate total revenue from non-voided orders
  const totalRevenue = nonVoidedOrders.reduce(
    (sum, order) => sum + order.total,
    0,
  );

  // 3. Apply commission rule
  let totalCommission: number;

  switch (rule.type) {
    case 'percentage':
      totalCommission = totalRevenue * rule.value;
      break;

    case 'per_order':
      totalCommission = ordersConsidered * rule.value;
      break;

    case 'tiered':
      totalCommission = calculateTieredCommission(totalRevenue, rule.tiers);
      break;
  }

  return {
    totalCommission,
    ordersConsidered,
    totalRevenue,
  };
}

/**
 * Finds the highest applicable tier and applies its percentage to the total revenue.
 *
 * Tiers are sorted by minRevenue descending and the first tier where
 * totalRevenue >= tier.minRevenue is used.
 *
 * If no tier applies (totalRevenue below all minRevenue thresholds), commission is 0.
 */
function calculateTieredCommission(
  totalRevenue: number,
  tiers: Array<{ minRevenue: number; percentage: number }>,
): number {
  if (tiers.length === 0) {
    return 0;
  }

  // Sort tiers by minRevenue descending to find highest applicable tier first
  const sortedTiers = [...tiers].sort((a, b) => b.minRevenue - a.minRevenue);

  for (const tier of sortedTiers) {
    if (totalRevenue >= tier.minRevenue) {
      return totalRevenue * tier.percentage;
    }
  }

  // No tier applies
  return 0;
}

// ─── Clock-in / Clock-out Interfaces ─────────────────────────────────────────

/**
 * Represents a clock-in/clock-out record for an employee at an outlet.
 * Requirement 29.1
 */
export interface ShiftRecord {
  id: string;
  tenantId: string;
  outletId: string;
  userId: string;
  clockIn: string; // ISO datetime
  clockOut: string | null; // null if currently clocked in
  scheduledStart: string | null; // ISO datetime, null if unscheduled
  scheduledEnd: string | null; // ISO datetime, null if unscheduled
}

// ─── Operator Performance Metrics ────────────────────────────────────────────

/**
 * Performance metrics for an operator over a given period.
 * Requirement 29.2
 */
export interface OperatorPerformanceMetrics {
  userId: string;
  outletId: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  ordersProcessed: number;
  revenueGenerated: number;
  averageServiceTimeMinutes: number;
}

// ─── Shift Scheduling ────────────────────────────────────────────────────────

/**
 * A scheduled shift assignment created by an Outlet_Admin.
 * Requirement 29.3
 */
export interface ScheduledShift {
  id: string;
  tenantId: string;
  outletId: string;
  userId: string;
  scheduledStart: string; // ISO datetime
  scheduledEnd: string; // ISO datetime
  createdBy: string; // Outlet_Admin user_id
}
