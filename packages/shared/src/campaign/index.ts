/**
 * Campaign grant eligibility module for the AIRE Operations Platform.
 *
 * Pure logic (no DB) for checking whether a campaign grant can be issued
 * based on total cap, per-customer limits, date window, and campaign status.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */

/**
 * Campaign status values matching the database constraint.
 */
export type CampaignStatus = 'active' | 'paused' | 'completed' | 'expired';

/**
 * Campaign data required for grant eligibility checks.
 */
export interface CampaignData {
  id: string;
  /**
   * Present when the campaign triggers on a membership plan purchase; null
   * when it triggers on a voucher-pack purchase instead (AIRIN-102). Unused
   * by the eligibility checks below — kept only for caller bookkeeping.
   */
  planId: string | null;
  startDate: string; // ISO date string (YYYY-MM-DD)
  endDate: string; // ISO date string (YYYY-MM-DD)
  cap: number | null; // total grants cap (null = unlimited)
  perCustomerLimit: number; // max grants per customer
  grantsCount: number; // current total grants issued
  status: CampaignStatus;
}

/**
 * Result of a grant eligibility check.
 */
export interface GrantEligibility {
  eligible: boolean;
  reason?:
    | 'cap_reached'
    | 'per_customer_exceeded'
    | 'outside_date_window'
    | 'campaign_inactive';
}

/**
 * Checks whether a campaign grant can be issued.
 *
 * Logic (checked in order):
 * 1. Campaign must be 'active' — otherwise ineligible (campaign_inactive)
 * 2. currentDate must be within [startDate, endDate] — otherwise ineligible (outside_date_window)
 * 3. If cap is not null and grantsCount >= cap — ineligible (cap_reached)
 * 4. If customerGrantCount >= perCustomerLimit — ineligible (per_customer_exceeded)
 * 5. Otherwise — eligible
 *
 * @param campaign - Campaign state data
 * @param customerGrantCount - Number of grants already issued to this customer for this campaign
 * @param currentDate - Current date as ISO string (YYYY-MM-DD)
 */
export function checkGrantEligibility(
  campaign: CampaignData,
  customerGrantCount: number,
  currentDate: string,
): GrantEligibility {
  // 1. Campaign must be active
  if (campaign.status !== 'active') {
    return { eligible: false, reason: 'campaign_inactive' };
  }

  // 2. Must be within date window [startDate, endDate]
  if (currentDate < campaign.startDate || currentDate > campaign.endDate) {
    return { eligible: false, reason: 'outside_date_window' };
  }

  // 3. Total cap enforcement (null = unlimited)
  if (campaign.cap !== null && campaign.grantsCount >= campaign.cap) {
    return { eligible: false, reason: 'cap_reached' };
  }

  // 4. Per-customer limit enforcement
  if (customerGrantCount >= campaign.perCustomerLimit) {
    return { eligible: false, reason: 'per_customer_exceeded' };
  }

  // 5. All checks passed
  return { eligible: true };
}
