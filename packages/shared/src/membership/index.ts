/**
 * Membership quota tracking module for the AIRE Operations Platform.
 *
 * Pure logic (no DB) for enforcing daily wash limits, lifetime quota caps,
 * and same-day reuse warnings.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

export {
  checkQuota,
  recordUsage,
  type MembershipQuotaState,
  type DailyUsageRecord,
  type QuotaCheckResult,
} from './quota-tracker';
