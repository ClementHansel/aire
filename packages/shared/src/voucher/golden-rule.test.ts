import { describe, it, expect } from 'vitest';
import { applyGoldenRule, CartItemWithBenefits } from './golden-rule';

describe('applyGoldenRule', () => {
  it('should apply voucher when both voucher and membership apply (golden rule)', () => {
    const items: CartItemWithBenefits[] = [
      {
        serviceId: 'svc-1',
        unitPrice: 100_000,
        quantity: 1,
        hasMembershipBenefit: true,
        hasVoucherBenefit: true,
        membershipDiscountAmount: 100_000,
        voucherDiscountAmount: 50_000,
      },
    ];

    const results = applyGoldenRule(items);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      serviceId: 'svc-1',
      appliedDiscount: 'voucher',
      discountAmount: 50_000,
      consumeMembershipQuota: false,
    });
  });

  it('should apply membership and consume quota when only membership applies', () => {
    const items: CartItemWithBenefits[] = [
      {
        serviceId: 'svc-2',
        unitPrice: 80_000,
        quantity: 1,
        hasMembershipBenefit: true,
        hasVoucherBenefit: false,
        membershipDiscountAmount: 80_000,
        voucherDiscountAmount: 0,
      },
    ];

    const results = applyGoldenRule(items);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      serviceId: 'svc-2',
      appliedDiscount: 'membership',
      discountAmount: 80_000,
      consumeMembershipQuota: true,
    });
  });

  it('should apply voucher and NOT consume quota when only voucher applies', () => {
    const items: CartItemWithBenefits[] = [
      {
        serviceId: 'svc-3',
        unitPrice: 120_000,
        quantity: 2,
        hasMembershipBenefit: false,
        hasVoucherBenefit: true,
        membershipDiscountAmount: 0,
        voucherDiscountAmount: 30_000,
      },
    ];

    const results = applyGoldenRule(items);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      serviceId: 'svc-3',
      appliedDiscount: 'voucher',
      discountAmount: 30_000,
      consumeMembershipQuota: false,
    });
  });

  it('should return no discount when neither benefit applies', () => {
    const items: CartItemWithBenefits[] = [
      {
        serviceId: 'svc-4',
        unitPrice: 50_000,
        quantity: 1,
        hasMembershipBenefit: false,
        hasVoucherBenefit: false,
        membershipDiscountAmount: 0,
        voucherDiscountAmount: 0,
      },
    ];

    const results = applyGoldenRule(items);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      serviceId: 'svc-4',
      appliedDiscount: 'none',
      discountAmount: 0,
      consumeMembershipQuota: false,
    });
  });

  it('should handle mixed items in same cart correctly', () => {
    const items: CartItemWithBenefits[] = [
      {
        // Both apply → voucher wins
        serviceId: 'svc-both',
        unitPrice: 100_000,
        quantity: 1,
        hasMembershipBenefit: true,
        hasVoucherBenefit: true,
        membershipDiscountAmount: 100_000,
        voucherDiscountAmount: 25_000,
      },
      {
        // Only membership → consume quota
        serviceId: 'svc-member-only',
        unitPrice: 75_000,
        quantity: 1,
        hasMembershipBenefit: true,
        hasVoucherBenefit: false,
        membershipDiscountAmount: 75_000,
        voucherDiscountAmount: 0,
      },
      {
        // Only voucher → no quota
        serviceId: 'svc-voucher-only',
        unitPrice: 60_000,
        quantity: 1,
        hasMembershipBenefit: false,
        hasVoucherBenefit: true,
        membershipDiscountAmount: 0,
        voucherDiscountAmount: 15_000,
      },
      {
        // Neither → no discount
        serviceId: 'svc-none',
        unitPrice: 40_000,
        quantity: 2,
        hasMembershipBenefit: false,
        hasVoucherBenefit: false,
        membershipDiscountAmount: 0,
        voucherDiscountAmount: 0,
      },
    ];

    const results = applyGoldenRule(items);

    expect(results).toHaveLength(4);

    // Both → voucher wins
    expect(results[0]).toEqual({
      serviceId: 'svc-both',
      appliedDiscount: 'voucher',
      discountAmount: 25_000,
      consumeMembershipQuota: false,
    });

    // Only membership → consume quota
    expect(results[1]).toEqual({
      serviceId: 'svc-member-only',
      appliedDiscount: 'membership',
      discountAmount: 75_000,
      consumeMembershipQuota: true,
    });

    // Only voucher → no quota
    expect(results[2]).toEqual({
      serviceId: 'svc-voucher-only',
      appliedDiscount: 'voucher',
      discountAmount: 15_000,
      consumeMembershipQuota: false,
    });

    // Neither → none
    expect(results[3]).toEqual({
      serviceId: 'svc-none',
      appliedDiscount: 'none',
      discountAmount: 0,
      consumeMembershipQuota: false,
    });
  });

  it('should only set consumeMembershipQuota true when membership applies without voucher', () => {
    const items: CartItemWithBenefits[] = [
      {
        serviceId: 'a',
        unitPrice: 100_000,
        quantity: 1,
        hasMembershipBenefit: true,
        hasVoucherBenefit: true,
        membershipDiscountAmount: 100_000,
        voucherDiscountAmount: 20_000,
      },
      {
        serviceId: 'b',
        unitPrice: 100_000,
        quantity: 1,
        hasMembershipBenefit: true,
        hasVoucherBenefit: false,
        membershipDiscountAmount: 100_000,
        voucherDiscountAmount: 0,
      },
      {
        serviceId: 'c',
        unitPrice: 100_000,
        quantity: 1,
        hasMembershipBenefit: false,
        hasVoucherBenefit: true,
        membershipDiscountAmount: 0,
        voucherDiscountAmount: 50_000,
      },
      {
        serviceId: 'd',
        unitPrice: 100_000,
        quantity: 1,
        hasMembershipBenefit: false,
        hasVoucherBenefit: false,
        membershipDiscountAmount: 0,
        voucherDiscountAmount: 0,
      },
    ];

    const results = applyGoldenRule(items);

    // Only item 'b' (membership only, no voucher) should have consumeMembershipQuota = true
    const quotaConsumingItems = results.filter((r) => r.consumeMembershipQuota);
    expect(quotaConsumingItems).toHaveLength(1);
    expect(quotaConsumingItems[0].serviceId).toBe('b');
  });

  it('should return empty array for empty input', () => {
    const results = applyGoldenRule([]);
    expect(results).toEqual([]);
  });
});
