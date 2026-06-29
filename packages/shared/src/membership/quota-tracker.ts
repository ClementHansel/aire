/**
 * Membership quota tracking logic for the AIRE Operations Platform.
 *
 * Pure logic module (no DB dependencies) that:
 * - Tracks usage per plate per day
 * - Enforces daily wash limit (configurable, default 1) resetting at 00:00 WIB
 * - Enforces lifetime quota cap → auto-set status to 'expired' when exhausted
 * - Records usage on paid order, tracks per-plate frequency
 * - Displays same-day reuse warning when daily limit reached
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { MembershipStatus } from '../enums';

/**
 * Represents the current state of a membership for quota checking purposes.
 */
export interface MembershipQuotaState {
  membershipId: string;
  usesCount: number; // lifetime uses so far
  maxUses: number; // lifetime cap
  dailyLimit: number; // per plate per day
  status: MembershipStatus;
}

/**
 * A single usage record for a given day.
 */
export interface DailyUsageRecord {
  plateNormalized: string;
  usedAt: string; // ISO datetime
}

/**
 * Result of a quota check — tells the caller whether a membership benefit
 * can be applied and what side effects should follow.
 */
export interface QuotaCheckResult {
  canUse: boolean;
  reason?: 'quota_exhausted' | 'daily_limit_reached';
  usesRemaining: number; // lifetime remaining
  dailyUsesToday: number; // uses today for this plate
  shouldExpire: boolean; // true if this use would exhaust quota
  warning?: string; // same-day reuse warning message
}

/**
 * Checks whether a membership benefit can be applied for the given plate
 * on the given day.
 *
 * Logic:
 * 1. If lifetime quota is already exhausted (usesCount >= maxUses)
 *    → canUse: false, reason: 'quota_exhausted', shouldExpire: true
 * 2. Count today's usages for the specific plate (filter by plate AND date)
 * 3. If todayUsesForPlate >= dailyLimit
 *    → canUse: false, reason: 'daily_limit_reached', warning message
 * 4. If usesCount + 1 === maxUses
 *    → canUse: true, shouldExpire: true (this use will exhaust quota)
 * 5. Otherwise → canUse: true
 *
 * @param state - Current membership quota state
 * @param plate - Normalized license plate (uppercase, no spaces)
 * @param todayUsages - All usage records for the current WIB day
 * @param currentDateWIB - The current date in WIB timezone (YYYY-MM-DD)
 */
export function checkQuota(
  state: MembershipQuotaState,
  plate: string,
  todayUsages: DailyUsageRecord[],
  currentDateWIB: string,
): QuotaCheckResult {
  const usesRemaining = Math.max(0, state.maxUses - state.usesCount);

  // 1. Lifetime quota already exhausted
  if (state.usesCount >= state.maxUses) {
    return {
      canUse: false,
      reason: 'quota_exhausted',
      usesRemaining: 0,
      dailyUsesToday: countDailyUsesForPlate(todayUsages, plate, currentDateWIB),
      shouldExpire: true,
    };
  }

  // 2. Count today's uses for this specific plate
  const dailyUsesToday = countDailyUsesForPlate(todayUsages, plate, currentDateWIB);

  // 3. Daily limit reached for this plate
  if (dailyUsesToday >= state.dailyLimit) {
    return {
      canUse: false,
      reason: 'daily_limit_reached',
      usesRemaining,
      dailyUsesToday,
      shouldExpire: false,
      warning: 'Vehicle already washed today',
    };
  }

  // 4. This use would exhaust the lifetime quota
  if (state.usesCount + 1 === state.maxUses) {
    return {
      canUse: true,
      usesRemaining: 1,
      dailyUsesToday,
      shouldExpire: true,
    };
  }

  // 5. Normal — within all limits
  return {
    canUse: true,
    usesRemaining,
    dailyUsesToday,
    shouldExpire: false,
  };
}

/**
 * Returns a new MembershipQuotaState with usesCount incremented by 1.
 * Pure function — does not mutate the input state.
 *
 * If the new usesCount reaches maxUses, the status is set to 'expired'.
 */
export function recordUsage(state: MembershipQuotaState): MembershipQuotaState {
  const newUsesCount = state.usesCount + 1;
  const newStatus =
    newUsesCount >= state.maxUses ? MembershipStatus.Expired : state.status;

  return {
    ...state,
    usesCount: newUsesCount,
    status: newStatus,
  };
}

/**
 * Counts the number of usages for a specific plate on the given WIB date.
 * Filters todayUsages by matching plate (case-insensitive) AND date portion
 * of usedAt matching currentDateWIB.
 */
function countDailyUsesForPlate(
  todayUsages: DailyUsageRecord[],
  plate: string,
  currentDateWIB: string,
): number {
  const normalizedPlate = plate.toUpperCase().replace(/\s+/g, '');

  return todayUsages.filter((usage) => {
    const usagePlate = usage.plateNormalized.toUpperCase().replace(/\s+/g, '');
    const usageDate = extractDateFromISO(usage.usedAt);
    return usagePlate === normalizedPlate && usageDate === currentDateWIB;
  }).length;
}

/**
 * Extracts the YYYY-MM-DD date portion from an ISO datetime string.
 * Handles both full ISO strings (2024-01-15T10:30:00+07:00) and date-only strings.
 */
function extractDateFromISO(isoDatetime: string): string {
  return isoDatetime.substring(0, 10);
}
