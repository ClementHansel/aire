import { describe, it, expect } from 'vitest';
import { CartItem } from './index';
import { applyMembershipPricing, MembershipBenefit, AppliedMemberPricing } from './membership-pricing';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    serviceId: 'svc-1',
    serviceName: 'Basic Wash',
    quantity: 1,
    unitPrice: 50000,
    discount: 0,
    isMainService: true,
    ...overrides,
  };
}

function makeBenefit(overrides: Partial<MembershipBenefit> = {}): MembershipBenefit {
  return {
    membershipId: 'mem-1',
    planName: 'Gold Plan',
    freeServiceIds: [],
    discountedServices: [],
    ...overrides,
  };
}

describe('applyMembershipPricing', () => {
  describe('no benefits', () => {
    it('returns items unchanged when benefits array is empty', () => {
      const items = [makeItem()];
      const result = applyMembershipPricing(items, []);

      expect(result.items).toEqual(items);
      expect(result.appliedPricing).toEqual([]);
    });

    it('returns items unchanged when no items match any benefit', () => {
      const items = [makeItem({ serviceId: 'svc-unmatched' })];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-other'] })];
      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(0);
      expect(result.appliedPricing).toEqual([]);
    });
  });

  describe('free services', () => {
    it('applies free pricing (price = 0) for services in freeServiceIds', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 50000, quantity: 1 })];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-1'] })];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(50000);
      expect(result.appliedPricing).toHaveLength(1);
      expect(result.appliedPricing[0]).toEqual({
        serviceId: 'svc-1',
        originalPrice: 50000,
        appliedPrice: 0,
        membershipId: 'mem-1',
        discountType: 'free',
        discountValue: 1.0,
        badgeLabel: 'GRATIS',
      });
    });

    it('applies free pricing considering quantity', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 50000, quantity: 3 })];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-1'] })];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(150000); // 50000 * 3
      expect(result.appliedPricing[0].originalPrice).toBe(150000);
      expect(result.appliedPricing[0].appliedPrice).toBe(0);
    });

    it('applies free pricing to multiple items', () => {
      const items = [
        makeItem({ serviceId: 'svc-1', unitPrice: 50000 }),
        makeItem({ serviceId: 'svc-2', serviceName: 'Premium Wash', unitPrice: 80000 }),
      ];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-1', 'svc-2'] })];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(50000);
      expect(result.items[1].discount).toBe(80000);
      expect(result.appliedPricing).toHaveLength(2);
      expect(result.appliedPricing[0].badgeLabel).toBe('GRATIS');
      expect(result.appliedPricing[1].badgeLabel).toBe('GRATIS');
    });
  });

  describe('discounted services', () => {
    it('applies percentage discount for services in discountedServices', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 100000, quantity: 1 })];
      const benefits = [
        makeBenefit({
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.2 }],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(20000); // 100000 * 0.2
      expect(result.appliedPricing[0]).toEqual({
        serviceId: 'svc-1',
        originalPrice: 100000,
        appliedPrice: 80000,
        membershipId: 'mem-1',
        discountType: 'percentage',
        discountValue: 0.2,
        badgeLabel: 'MEMBER -20%',
      });
    });

    it('applies percentage discount considering quantity', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 50000, quantity: 2 })];
      const benefits = [
        makeBenefit({
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.3 }],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(30000); // 50000 * 2 * 0.3
      expect(result.appliedPricing[0].originalPrice).toBe(100000);
      expect(result.appliedPricing[0].appliedPrice).toBe(70000);
      expect(result.appliedPricing[0].badgeLabel).toBe('MEMBER -30%');
    });
  });

  describe('multiple plans - best benefit selection', () => {
    it('picks the free benefit over a percentage discount when both plans cover the same service', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 50000 })];
      const benefits = [
        makeBenefit({
          membershipId: 'mem-1',
          planName: 'Basic',
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.5 }],
        }),
        makeBenefit({
          membershipId: 'mem-2',
          planName: 'Premium',
          freeServiceIds: ['svc-1'],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(50000);
      expect(result.appliedPricing[0].discountType).toBe('free');
      expect(result.appliedPricing[0].membershipId).toBe('mem-2');
      expect(result.appliedPricing[0].badgeLabel).toBe('GRATIS');
    });

    it('picks the highest percentage discount when multiple plans offer different percentages', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 100000 })];
      const benefits = [
        makeBenefit({
          membershipId: 'mem-1',
          planName: 'Basic',
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.1 }],
        }),
        makeBenefit({
          membershipId: 'mem-2',
          planName: 'Premium',
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.4 }],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(40000); // best: 40%
      expect(result.appliedPricing[0].discountValue).toBe(0.4);
      expect(result.appliedPricing[0].membershipId).toBe('mem-2');
      expect(result.appliedPricing[0].badgeLabel).toBe('MEMBER -40%');
    });

    it('applies different benefits from different plans to different services', () => {
      const items = [
        makeItem({ serviceId: 'svc-1', unitPrice: 50000 }),
        makeItem({ serviceId: 'svc-2', serviceName: 'Premium', unitPrice: 80000, isMainService: false }),
      ];
      const benefits = [
        makeBenefit({
          membershipId: 'mem-1',
          planName: 'Plan A',
          freeServiceIds: ['svc-1'],
        }),
        makeBenefit({
          membershipId: 'mem-2',
          planName: 'Plan B',
          discountedServices: [{ serviceId: 'svc-2', discountPct: 0.25 }],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      // svc-1: free from Plan A
      expect(result.items[0].discount).toBe(50000);
      expect(result.appliedPricing[0].discountType).toBe('free');
      expect(result.appliedPricing[0].membershipId).toBe('mem-1');

      // svc-2: 25% off from Plan B
      expect(result.items[1].discount).toBe(20000); // 80000 * 0.25
      expect(result.appliedPricing[1].discountType).toBe('percentage');
      expect(result.appliedPricing[1].membershipId).toBe('mem-2');
    });
  });

  describe('edge cases', () => {
    it('does not mutate the original items array', () => {
      const items = [makeItem({ serviceId: 'svc-1', discount: 0 })];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-1'] })];

      applyMembershipPricing(items, benefits);

      expect(items[0].discount).toBe(0); // original unchanged
    });

    it('handles zero unit price gracefully', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 0 })];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-1'] })];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[0].discount).toBe(0);
      expect(result.appliedPricing[0].originalPrice).toBe(0);
      expect(result.appliedPricing[0].appliedPrice).toBe(0);
    });

    it('handles a service in both freeServiceIds and discountedServices of same plan - free wins', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 50000 })];
      const benefits = [
        makeBenefit({
          freeServiceIds: ['svc-1'],
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.5 }],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      expect(result.appliedPricing[0].discountType).toBe('free');
      expect(result.appliedPricing[0].badgeLabel).toBe('GRATIS');
    });

    it('leaves items without benefits unmodified in the returned array', () => {
      const items = [
        makeItem({ serviceId: 'svc-1', unitPrice: 50000 }),
        makeItem({ serviceId: 'svc-no-benefit', serviceName: 'Add-on', unitPrice: 20000, isMainService: false }),
      ];
      const benefits = [makeBenefit({ freeServiceIds: ['svc-1'] })];

      const result = applyMembershipPricing(items, benefits);

      expect(result.items[1].discount).toBe(0);
      expect(result.appliedPricing).toHaveLength(1);
      expect(result.appliedPricing[0].serviceId).toBe('svc-1');
    });

    it('handles badge label rounding for non-integer percentages', () => {
      const items = [makeItem({ serviceId: 'svc-1', unitPrice: 100000 })];
      const benefits = [
        makeBenefit({
          discountedServices: [{ serviceId: 'svc-1', discountPct: 0.15 }],
        }),
      ];

      const result = applyMembershipPricing(items, benefits);

      expect(result.appliedPricing[0].badgeLabel).toBe('MEMBER -15%');
    });
  });
});
