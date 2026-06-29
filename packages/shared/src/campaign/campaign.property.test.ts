import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  checkGrantEligibility,
  CampaignData,
  CampaignStatus,
} from './index';

/**
 * Property-based tests for campaign grant cap enforcement.
 *
 * **Validates: Requirements 19.4**
 */

/** Valid campaign statuses */
const allStatuses: CampaignStatus[] = ['active', 'paused', 'completed', 'expired'];
const inactiveStatuses: CampaignStatus[] = ['paused', 'completed', 'expired'];

/** Arbitrary for a date string in YYYY-MM-DD format */
const arbDate = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }), // use 28 to avoid invalid days
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Arbitrary for a date window: [startDate, endDate] where start <= end */
const arbDateWindow = arbDate.chain((start) =>
  fc
    .integer({ min: 0, max: 365 })
    .map((daysAfter) => {
      const startD = new Date(start);
      const endD = new Date(startD.getTime() + daysAfter * 86400000);
      const endStr = endD.toISOString().substring(0, 10);
      return { startDate: start, endDate: endStr };
    }),
);

/** Arbitrary for a date within a given window [start, end] */
function arbDateInWindow(startDate: string, endDate: string) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  return fc
    .integer({ min: startMs, max: endMs })
    .map((ms) => new Date(ms).toISOString().substring(0, 10));
}

/** Arbitrary for a date outside a given window */
function arbDateOutsideWindow(startDate: string, endDate: string) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  return fc.oneof(
    // Before the window
    fc
      .integer({ min: startMs - 365 * 86400000, max: startMs - 86400000 })
      .map((ms) => new Date(ms).toISOString().substring(0, 10)),
    // After the window
    fc
      .integer({ min: endMs + 86400000, max: endMs + 365 * 86400000 })
      .map((ms) => new Date(ms).toISOString().substring(0, 10)),
  );
}

/** Arbitrary for a positive cap (finite) */
const arbCap = fc.integer({ min: 1, max: 10000 });

/** Arbitrary for per-customer limit */
const arbPerCustomerLimit = fc.integer({ min: 1, max: 100 });

/** Arbitrary campaign ID */
const arbId = fc.uuid();

describe('checkGrantEligibility - Property-Based Tests', () => {
  describe('Property 22: Campaign Grant Cap Enforcement', () => {
    it('total cap: rejects when grantsCount >= cap', () => {
      fc.assert(
        fc.property(
          arbId,
          arbId,
          arbDateWindow,
          arbCap,
          arbPerCustomerLimit,
          (id, planId, window, cap, perCustomerLimit) => {
            // grantsCount at or above the cap
            const grantsCount = fc.sample(
              fc.integer({ min: cap, max: cap + 100 }),
              1,
            )[0];

            const campaign: CampaignData = {
              id,
              planId,
              startDate: window.startDate,
              endDate: window.endDate,
              cap,
              perCustomerLimit,
              grantsCount,
              status: 'active',
            };

            // Use a date within the window and customer within limit
            const currentDate = window.startDate; // guaranteed within window
            const customerGrantCount = 0; // within per-customer limit

            const result = checkGrantEligibility(campaign, customerGrantCount, currentDate);

            expect(result.eligible).toBe(false);
            expect(result.reason).toBe('cap_reached');
          },
        ),
        { numRuns: 200 },
      );
    });

    it('below cap: eligible when active, within date window, grantsCount < cap, and customer within limit', () => {
      fc.assert(
        fc.property(
          arbId,
          arbId,
          arbDateWindow,
          arbCap,
          arbPerCustomerLimit,
          (id, planId, window, cap, perCustomerLimit) => {
            // grantsCount below cap
            const grantsCount = fc.sample(
              fc.integer({ min: 0, max: cap - 1 }),
              1,
            )[0];

            const campaign: CampaignData = {
              id,
              planId,
              startDate: window.startDate,
              endDate: window.endDate,
              cap,
              perCustomerLimit,
              grantsCount,
              status: 'active',
            };

            // Date within window
            const currentDate = fc.sample(
              arbDateInWindow(window.startDate, window.endDate),
              1,
            )[0];

            // Customer within per-customer limit
            const customerGrantCount = fc.sample(
              fc.integer({ min: 0, max: perCustomerLimit - 1 }),
              1,
            )[0];

            const result = checkGrantEligibility(campaign, customerGrantCount, currentDate);

            expect(result.eligible).toBe(true);
            expect(result.reason).toBeUndefined();
          },
        ),
        { numRuns: 200 },
      );
    });

    it('per-customer limit: rejects when customerGrantCount >= perCustomerLimit', () => {
      fc.assert(
        fc.property(
          arbId,
          arbId,
          arbDateWindow,
          arbPerCustomerLimit,
          (id, planId, window, perCustomerLimit) => {
            // customerGrantCount at or exceeding limit
            const customerGrantCount = fc.sample(
              fc.integer({ min: perCustomerLimit, max: perCustomerLimit + 50 }),
              1,
            )[0];

            const campaign: CampaignData = {
              id,
              planId,
              startDate: window.startDate,
              endDate: window.endDate,
              cap: null, // unlimited cap so cap is not the reason
              perCustomerLimit,
              grantsCount: 0,
              status: 'active',
            };

            // Date within window
            const currentDate = window.startDate;

            const result = checkGrantEligibility(campaign, customerGrantCount, currentDate);

            expect(result.eligible).toBe(false);
            expect(result.reason).toBe('per_customer_exceeded');
          },
        ),
        { numRuns: 200 },
      );
    });

    it('date window: rejects when currentDate is outside [startDate, endDate]', () => {
      fc.assert(
        fc.property(
          arbId,
          arbId,
          arbDateWindow,
          arbPerCustomerLimit,
          (id, planId, window, perCustomerLimit) => {
            const campaign: CampaignData = {
              id,
              planId,
              startDate: window.startDate,
              endDate: window.endDate,
              cap: null,
              perCustomerLimit,
              grantsCount: 0,
              status: 'active',
            };

            // Date outside the window
            const currentDate = fc.sample(
              arbDateOutsideWindow(window.startDate, window.endDate),
              1,
            )[0];
            const customerGrantCount = 0;

            const result = checkGrantEligibility(campaign, customerGrantCount, currentDate);

            expect(result.eligible).toBe(false);
            expect(result.reason).toBe('outside_date_window');
          },
        ),
        { numRuns: 200 },
      );
    });

    it('inactive campaign: rejects when status !== active', () => {
      fc.assert(
        fc.property(
          arbId,
          arbId,
          arbDateWindow,
          fc.constantFrom(...inactiveStatuses),
          arbPerCustomerLimit,
          (id, planId, window, status, perCustomerLimit) => {
            const campaign: CampaignData = {
              id,
              planId,
              startDate: window.startDate,
              endDate: window.endDate,
              cap: null,
              perCustomerLimit,
              grantsCount: 0,
              status,
            };

            // All other conditions met
            const currentDate = window.startDate;
            const customerGrantCount = 0;

            const result = checkGrantEligibility(campaign, customerGrantCount, currentDate);

            expect(result.eligible).toBe(false);
            expect(result.reason).toBe('campaign_inactive');
          },
        ),
        { numRuns: 200 },
      );
    });

    it('unlimited cap: cap is never the rejection reason when cap is null', () => {
      fc.assert(
        fc.property(
          arbId,
          arbId,
          arbDateWindow,
          arbPerCustomerLimit,
          fc.integer({ min: 0, max: 1000000 }),
          (id, planId, window, perCustomerLimit, grantsCount) => {
            const campaign: CampaignData = {
              id,
              planId,
              startDate: window.startDate,
              endDate: window.endDate,
              cap: null, // unlimited
              perCustomerLimit,
              grantsCount,
              status: 'active',
            };

            // Date within window, customer within limit
            const currentDate = window.startDate;
            const customerGrantCount = 0;

            const result = checkGrantEligibility(campaign, customerGrantCount, currentDate);

            // With cap=null, the reason should never be 'cap_reached'
            // The result may be eligible or rejected for other reasons, but never cap
            expect(result.reason).not.toBe('cap_reached');
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
