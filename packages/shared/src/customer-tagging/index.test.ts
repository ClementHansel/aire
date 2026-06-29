import { describe, it, expect } from 'vitest';
import {
  assignCustomerTags,
  revertCustomerTags,
  OrderContext,
  CustomerTag,
} from './index';

describe('assignCustomerTags', () => {
  const emptyContext: OrderContext = {
    hasVoucherPackPurchase: false,
    hasNewMembership: false,
    hasMembershipRenewal: false,
    hasVoucherRedemption: false,
    hasMemberBenefitsApplied: false,
  };

  describe('individual conditions', () => {
    it('should assign "buy_voucher_pack" when order contains a voucher pack purchase', () => {
      const context: OrderContext = { ...emptyContext, hasVoucherPackPurchase: true };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('buy_voucher_pack');
      expect(tags).not.toContain('regular');
    });

    it('should assign "new_member" when order creates a new membership', () => {
      const context: OrderContext = { ...emptyContext, hasNewMembership: true };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('new_member');
      expect(tags).not.toContain('regular');
    });

    it('should assign "renewal" when order renews a membership', () => {
      const context: OrderContext = { ...emptyContext, hasMembershipRenewal: true };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('renewal');
      expect(tags).not.toContain('regular');
    });

    it('should assign "voucher" when order uses voucher codes', () => {
      const context: OrderContext = { ...emptyContext, hasVoucherRedemption: true };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('voucher');
      expect(tags).not.toContain('regular');
    });

    it('should assign "member" when order uses membership pricing', () => {
      const context: OrderContext = { ...emptyContext, hasMemberBenefitsApplied: true };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('member');
      expect(tags).not.toContain('regular');
    });
  });

  describe('fallback to regular', () => {
    it('should assign "regular" when no other condition applies', () => {
      const tags = assignCustomerTags(emptyContext);
      expect(tags).toEqual(['regular']);
    });

    it('should assign only "regular" when all conditions are false', () => {
      const tags = assignCustomerTags(emptyContext);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toBe('regular');
    });
  });

  describe('regular exclusion', () => {
    it('should NOT assign "regular" when any other tag is assigned', () => {
      const context: OrderContext = { ...emptyContext, hasVoucherRedemption: true };
      const tags = assignCustomerTags(context);
      expect(tags).not.toContain('regular');
    });

    it('should NOT assign "regular" when multiple tags are assigned', () => {
      const context: OrderContext = {
        ...emptyContext,
        hasNewMembership: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      expect(tags).not.toContain('regular');
    });
  });

  describe('multiple conditions (combined tags)', () => {
    it('should assign both "new_member" and "member" when buying membership and using benefits', () => {
      const context: OrderContext = {
        ...emptyContext,
        hasNewMembership: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('new_member');
      expect(tags).toContain('member');
      expect(tags).toHaveLength(2);
    });

    it('should assign "buy_voucher_pack" and "member" when buying pack with member pricing', () => {
      const context: OrderContext = {
        ...emptyContext,
        hasVoucherPackPurchase: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('buy_voucher_pack');
      expect(tags).toContain('member');
      expect(tags).toHaveLength(2);
    });

    it('should assign "voucher" and "member" when using voucher with member pricing', () => {
      const context: OrderContext = {
        ...emptyContext,
        hasVoucherRedemption: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('voucher');
      expect(tags).toContain('member');
      expect(tags).toHaveLength(2);
    });

    it('should assign all applicable tags when all conditions are true', () => {
      const context: OrderContext = {
        hasVoucherPackPurchase: true,
        hasNewMembership: true,
        hasMembershipRenewal: true,
        hasVoucherRedemption: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('buy_voucher_pack');
      expect(tags).toContain('new_member');
      expect(tags).toContain('renewal');
      expect(tags).toContain('voucher');
      expect(tags).toContain('member');
      expect(tags).not.toContain('regular');
      expect(tags).toHaveLength(5);
    });

    it('should assign "renewal" and "voucher" when renewing with voucher redemption', () => {
      const context: OrderContext = {
        ...emptyContext,
        hasMembershipRenewal: true,
        hasVoucherRedemption: true,
      };
      const tags = assignCustomerTags(context);
      expect(tags).toContain('renewal');
      expect(tags).toContain('voucher');
      expect(tags).toHaveLength(2);
    });
  });

  describe('return value guarantees', () => {
    it('should never return an empty array', () => {
      const tags = assignCustomerTags(emptyContext);
      expect(tags.length).toBeGreaterThan(0);
    });

    it('should return only valid CustomerTag values', () => {
      const validTags: CustomerTag[] = [
        'regular',
        'member',
        'voucher',
        'new_member',
        'renewal',
        'buy_voucher_pack',
      ];
      const context: OrderContext = {
        hasVoucherPackPurchase: true,
        hasNewMembership: true,
        hasMembershipRenewal: true,
        hasVoucherRedemption: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      for (const tag of tags) {
        expect(validTags).toContain(tag);
      }
    });

    it('should not contain duplicate tags', () => {
      const context: OrderContext = {
        hasVoucherPackPurchase: true,
        hasNewMembership: true,
        hasMembershipRenewal: true,
        hasVoucherRedemption: true,
        hasMemberBenefitsApplied: true,
      };
      const tags = assignCustomerTags(context);
      const unique = new Set(tags);
      expect(unique.size).toBe(tags.length);
    });
  });
});

describe('revertCustomerTags', () => {
  it('should return an empty array indicating all tags are removed on void', () => {
    const tags = revertCustomerTags();
    expect(tags).toEqual([]);
  });

  it('should return an array (not undefined or null)', () => {
    const tags = revertCustomerTags();
    expect(Array.isArray(tags)).toBe(true);
  });
});
