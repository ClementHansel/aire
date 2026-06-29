import { describe, it, expect } from 'vitest';
import { checkGrantEligibility, CampaignData } from './index';

/** Helper to create a base campaign with sensible defaults */
function makeCampaign(overrides: Partial<CampaignData> = {}): CampaignData {
  return {
    id: 'campaign-001',
    planId: 'plan-gold',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    cap: 100,
    perCustomerLimit: 1,
    grantsCount: 0,
    status: 'active',
    ...overrides,
  };
}

describe('checkGrantEligibility', () => {
  describe('eligible — all conditions pass', () => {
    it('returns eligible when all checks pass', () => {
      const campaign = makeCampaign();
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns eligible with null cap (unlimited)', () => {
      const campaign = makeCampaign({ cap: null, grantsCount: 9999 });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns eligible at start date boundary', () => {
      const campaign = makeCampaign({ startDate: '2024-03-01' });
      const result = checkGrantEligibility(campaign, 0, '2024-03-01');

      expect(result.eligible).toBe(true);
    });

    it('returns eligible at end date boundary', () => {
      const campaign = makeCampaign({ endDate: '2024-06-30' });
      const result = checkGrantEligibility(campaign, 0, '2024-06-30');

      expect(result.eligible).toBe(true);
    });

    it('returns eligible when grantsCount is just below cap', () => {
      const campaign = makeCampaign({ cap: 50, grantsCount: 49 });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(true);
    });

    it('returns eligible when customerGrantCount is below perCustomerLimit', () => {
      const campaign = makeCampaign({ perCustomerLimit: 3 });
      const result = checkGrantEligibility(campaign, 2, '2024-06-15');

      expect(result.eligible).toBe(true);
    });
  });

  describe('campaign_inactive — status is not active', () => {
    it('rejects paused campaign', () => {
      const campaign = makeCampaign({ status: 'paused' });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('campaign_inactive');
    });

    it('rejects completed campaign', () => {
      const campaign = makeCampaign({ status: 'completed' });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('campaign_inactive');
    });

    it('rejects expired campaign', () => {
      const campaign = makeCampaign({ status: 'expired' });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('campaign_inactive');
    });
  });

  describe('outside_date_window — currentDate not within [startDate, endDate]', () => {
    it('rejects when currentDate is before startDate', () => {
      const campaign = makeCampaign({ startDate: '2024-03-01' });
      const result = checkGrantEligibility(campaign, 0, '2024-02-28');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('outside_date_window');
    });

    it('rejects when currentDate is after endDate', () => {
      const campaign = makeCampaign({ endDate: '2024-06-30' });
      const result = checkGrantEligibility(campaign, 0, '2024-07-01');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('outside_date_window');
    });

    it('rejects the day after endDate', () => {
      const campaign = makeCampaign({ endDate: '2024-12-31' });
      const result = checkGrantEligibility(campaign, 0, '2025-01-01');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('outside_date_window');
    });
  });

  describe('cap_reached — total grants cap exhausted', () => {
    it('rejects when grantsCount equals cap', () => {
      const campaign = makeCampaign({ cap: 100, grantsCount: 100 });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('cap_reached');
    });

    it('rejects when grantsCount exceeds cap', () => {
      const campaign = makeCampaign({ cap: 50, grantsCount: 51 });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('cap_reached');
    });

    it('does not reject when cap is null (unlimited)', () => {
      const campaign = makeCampaign({ cap: null, grantsCount: 99999 });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(true);
    });

    it('rejects when cap is 0 and grantsCount is 0', () => {
      const campaign = makeCampaign({ cap: 0, grantsCount: 0 });
      const result = checkGrantEligibility(campaign, 0, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('cap_reached');
    });
  });

  describe('per_customer_exceeded — customer already received max grants', () => {
    it('rejects when customerGrantCount equals perCustomerLimit', () => {
      const campaign = makeCampaign({ perCustomerLimit: 1 });
      const result = checkGrantEligibility(campaign, 1, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('per_customer_exceeded');
    });

    it('rejects when customerGrantCount exceeds perCustomerLimit', () => {
      const campaign = makeCampaign({ perCustomerLimit: 2 });
      const result = checkGrantEligibility(campaign, 3, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('per_customer_exceeded');
    });

    it('allows when customerGrantCount is below perCustomerLimit', () => {
      const campaign = makeCampaign({ perCustomerLimit: 5 });
      const result = checkGrantEligibility(campaign, 4, '2024-06-15');

      expect(result.eligible).toBe(true);
    });
  });

  describe('priority order — first failing condition wins', () => {
    it('returns campaign_inactive before checking dates', () => {
      // Campaign is paused AND outside date window AND cap reached
      const campaign = makeCampaign({
        status: 'paused',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        cap: 10,
        grantsCount: 10,
      });
      const result = checkGrantEligibility(campaign, 5, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('campaign_inactive');
    });

    it('returns outside_date_window before checking cap', () => {
      // Active campaign, outside date, cap reached
      const campaign = makeCampaign({
        status: 'active',
        startDate: '2024-01-01',
        endDate: '2024-06-30',
        cap: 10,
        grantsCount: 10,
      });
      const result = checkGrantEligibility(campaign, 5, '2024-07-01');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('outside_date_window');
    });

    it('returns cap_reached before checking per_customer', () => {
      // Active campaign, within dates, cap reached, per-customer exceeded
      const campaign = makeCampaign({
        status: 'active',
        cap: 10,
        grantsCount: 10,
        perCustomerLimit: 1,
      });
      const result = checkGrantEligibility(campaign, 5, '2024-06-15');

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('cap_reached');
    });
  });
});
