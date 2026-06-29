import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VoucherType } from '../enums';
import { VoucherData, VoucherEvaluationContext, evaluateVoucher } from './index';

/**
 * Property-based tests for voucher condition validation.
 *
 * **Validates: Requirements 17.3, 17.4**
 *
 * Property 12: Voucher Condition Validation
 * For any valid voucher: conditions met → discount calculated (blue badge);
 * conditions not met → discount zero + warning (orange badge) without invalidating code.
 */

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** All voucher type values */
const voucherTypeArb = fc.constantFrom(
  VoucherType.Fixed,
  VoucherType.Percentage,
  VoucherType.ServicePack,
);

/** Generate a valid ISO date string (YYYY-MM-DD) */
const dateArb = fc
  .tuple(
    fc.integer({ min: 2024, max: 2027 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Generate a UUID-like identifier */
const idArb = fc.uuid();

/** Generate a non-empty array of IDs */
const idArrayArb = fc.array(idArb, { minLength: 1, maxLength: 5 });

/** Generate a vehicle brand string */
const brandArb = fc.constantFrom('Toyota', 'Honda', 'Suzuki', 'BMW', 'Mercedes', 'Mitsubishi', 'Daihatsu');

/**
 * Generate a "base valid" voucher: active, not parent, uses available, within date range.
 * This ensures we bypass all error states (not_found, parent_code, inactive, fully_redeemed, expired, not_yet_active)
 * and only test the condition evaluation path.
 */
const baseValidVoucherArb = (currentDate: string): fc.Arbitrary<VoucherData> =>
  fc
    .record({
      type: voucherTypeArb,
      value: fc.integer({ min: 0, max: 500000 }),
      maxUses: fc.integer({ min: 1, max: 100 }),
      currentUsesOffset: fc.integer({ min: 0, max: 98 }), // will be less than maxUses
      outletIds: fc.constant(null as string[] | null),
      brandScope: fc.constant(null as string[] | null),
      serviceIds: fc.constant(null as string[] | null),
      minOrderAmount: fc.constant(0),
    })
    .map((r) => ({
      type: r.type,
      value: r.value,
      maxUses: r.maxUses,
      currentUses: Math.min(r.currentUsesOffset, r.maxUses - 1), // always less than maxUses
      startDate: null, // null = no start restriction
      expiryDate: null, // null = no expiry restriction
      outletIds: r.outletIds,
      brandScope: r.brandScope,
      serviceIds: r.serviceIds,
      minOrderAmount: r.minOrderAmount,
      isActive: true,
      isParentCode: false,
    }));

/**
 * Generate a voucher with ALL conditions met for a given context.
 * This means: outlet matches (or null), brand matches (or null), service matches (or null), min order met.
 */
const voucherWithConditionsMetArb: fc.Arbitrary<{
  voucher: VoucherData;
  context: VoucherEvaluationContext;
}> = fc
  .record({
    type: voucherTypeArb,
    value: fc.integer({ min: 0, max: 500000 }),
    maxUses: fc.integer({ min: 1, max: 100 }),
    currentUsesOffset: fc.integer({ min: 0, max: 98 }),
    outletId: idArb,
    vehicleBrand: brandArb,
    serviceIds: idArrayArb,
    orderSubtotal: fc.integer({ min: 0, max: 1000000 }),
    currentDate: dateArb,
    // Whether to use scoped or null for each condition
    useOutletScope: fc.boolean(),
    useBrandScope: fc.boolean(),
    useServiceScope: fc.boolean(),
    useMinOrder: fc.boolean(),
    minOrderFraction: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map((r) => {
    // When useMinOrder is true, set minOrderAmount to a value <= orderSubtotal
    // so the condition is met. Use fraction of orderSubtotal to ensure this.
    const minOrderAmount = r.useMinOrder
      ? Math.floor(r.minOrderFraction * r.orderSubtotal)
      : 0;

    const voucher: VoucherData = {
      type: r.type,
      value: r.value,
      maxUses: r.maxUses,
      currentUses: Math.min(r.currentUsesOffset, r.maxUses - 1),
      startDate: null,
      expiryDate: null,
      // If scoped, include the context's outletId so it matches
      outletIds: r.useOutletScope ? [r.outletId] : null,
      // If scoped, include the context's brand so it matches
      brandScope: r.useBrandScope ? [r.vehicleBrand] : null,
      // If scoped, include at least one of the context's service IDs so it matches
      serviceIds: r.useServiceScope ? [r.serviceIds[0]] : null,
      minOrderAmount,
      isActive: true,
      isParentCode: false,
    };

    const context: VoucherEvaluationContext = {
      outletId: r.outletId,
      vehicleBrand: r.vehicleBrand,
      serviceIdsInCart: r.serviceIds,
      orderSubtotal: r.orderSubtotal,
      currentDate: r.currentDate,
    };

    return { voucher, context };
  });

/**
 * Generate a voucher with at least one condition NOT met for a given context.
 * The voucher itself remains valid (active, not parent, uses available, in date range).
 */
const voucherWithConditionNotMetArb: fc.Arbitrary<{
  voucher: VoucherData;
  context: VoucherEvaluationContext;
  mismatchType: 'outlet' | 'brand' | 'service' | 'minOrder';
}> = fc
  .record({
    type: voucherTypeArb,
    value: fc.integer({ min: 0, max: 500000 }),
    maxUses: fc.integer({ min: 1, max: 100 }),
    currentUsesOffset: fc.integer({ min: 0, max: 98 }),
    outletId: idArb,
    differentOutletId: idArb,
    vehicleBrand: brandArb,
    differentBrand: brandArb,
    serviceIdsInCart: idArrayArb,
    differentServiceIds: idArrayArb,
    orderSubtotal: fc.integer({ min: 0, max: 500000 }),
    currentDate: dateArb,
    mismatchType: fc.constantFrom('outlet' as const, 'brand' as const, 'service' as const, 'minOrder' as const),
  })
  .filter((r) => {
    // Ensure different IDs/brands are actually different
    if (r.mismatchType === 'outlet') return r.outletId !== r.differentOutletId;
    if (r.mismatchType === 'brand') return r.vehicleBrand !== r.differentBrand;
    if (r.mismatchType === 'service') {
      // Ensure no overlap between cart services and voucher services
      const cartSet = new Set(r.serviceIdsInCart);
      return r.differentServiceIds.every((id) => !cartSet.has(id));
    }
    // minOrder: subtotal must be strictly less than minOrderAmount
    return true;
  })
  .map((r) => {
    const voucher: VoucherData = {
      type: r.type,
      value: r.value,
      maxUses: r.maxUses,
      currentUses: Math.min(r.currentUsesOffset, r.maxUses - 1),
      startDate: null,
      expiryDate: null,
      outletIds: null,
      brandScope: null,
      serviceIds: null,
      minOrderAmount: 0,
      isActive: true,
      isParentCode: false,
    };

    const context: VoucherEvaluationContext = {
      outletId: r.outletId,
      vehicleBrand: r.vehicleBrand,
      serviceIdsInCart: r.serviceIdsInCart,
      orderSubtotal: r.orderSubtotal,
      currentDate: r.currentDate,
    };

    // Apply the specific mismatch condition
    switch (r.mismatchType) {
      case 'outlet':
        voucher.outletIds = [r.differentOutletId];
        break;
      case 'brand':
        voucher.brandScope = [r.differentBrand];
        break;
      case 'service':
        voucher.serviceIds = r.differentServiceIds;
        break;
      case 'minOrder':
        // Set minOrderAmount higher than orderSubtotal
        voucher.minOrderAmount = r.orderSubtotal + 1;
        break;
    }

    return { voucher, context, mismatchType: r.mismatchType };
  });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('evaluateVoucher - Property-Based Tests', () => {
  describe('Property 12: Voucher Condition Validation', () => {
    it('conditions met → status is valid_applicable with correct type and discountValue', () => {
      fc.assert(
        fc.property(voucherWithConditionsMetArb, ({ voucher, context }) => {
          const result = evaluateVoucher(voucher, context);

          expect(result.status).toBe('valid_applicable');
          if (result.status === 'valid_applicable') {
            expect(result.type).toBe(voucher.type);
            expect(result.discountValue).toBe(voucher.value);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('at least one condition NOT met → status is valid_not_applicable with reason', () => {
      fc.assert(
        fc.property(voucherWithConditionNotMetArb, ({ voucher, context }) => {
          const result = evaluateVoucher(voucher, context);

          expect(result.status).toBe('valid_not_applicable');
          if (result.status === 'valid_not_applicable') {
            expect(result.reason).toBeDefined();
            expect(result.reason.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('valid_not_applicable still carries voucher type (code not invalidated)', () => {
      fc.assert(
        fc.property(voucherWithConditionNotMetArb, ({ voucher, context }) => {
          const result = evaluateVoucher(voucher, context);

          if (result.status === 'valid_not_applicable') {
            expect(result.type).toBe(voucher.type);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('valid_not_applicable still carries voucher discountValue (code not invalidated)', () => {
      fc.assert(
        fc.property(voucherWithConditionNotMetArb, ({ voucher, context }) => {
          const result = evaluateVoucher(voucher, context);

          if (result.status === 'valid_not_applicable') {
            expect(result.discountValue).toBe(voucher.value);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('result type always matches voucher type for both applicable and not-applicable', () => {
      fc.assert(
        fc.property(
          fc.oneof(voucherWithConditionsMetArb, voucherWithConditionNotMetArb),
          (input) => {
            const { voucher, context } = input;
            const result = evaluateVoucher(voucher, context);

            if (result.status === 'valid_applicable' || result.status === 'valid_not_applicable') {
              expect(result.type).toBe(voucher.type);
            }
          },
        ),
        { numRuns: 500 },
      );
    });

    it('discountValue always matches voucher value for both applicable and not-applicable', () => {
      fc.assert(
        fc.property(
          fc.oneof(voucherWithConditionsMetArb, voucherWithConditionNotMetArb),
          (input) => {
            const { voucher, context } = input;
            const result = evaluateVoucher(voucher, context);

            if (result.status === 'valid_applicable' || result.status === 'valid_not_applicable') {
              expect(result.discountValue).toBe(voucher.value);
            }
          },
        ),
        { numRuns: 500 },
      );
    });
  });
});
