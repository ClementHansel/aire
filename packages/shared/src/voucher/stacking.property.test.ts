import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canStackVoucher, AppliedVoucher } from './stacking';
import { VoucherType } from '../enums';

/**
 * Property-based tests for voucher stacking limit.
 *
 * **Validates: Requirements 17.2**
 */

/** All valid voucher types */
const allVoucherTypes = [VoucherType.Fixed, VoucherType.Percentage, VoucherType.ServicePack];

/** Arbitrary generator for a VoucherType */
const arbVoucherType = fc.constantFrom(...allVoucherTypes);

/** Arbitrary generator for a positive discount value */
const arbDiscountValue = fc.integer({ min: 1, max: 500_000 });

/** Arbitrary generator for a voucher code string */
const arbVoucherCode = fc.string({ minLength: 3, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Arbitrary generator for an AppliedVoucher */
const arbAppliedVoucher = fc.record({
  code: arbVoucherCode,
  type: arbVoucherType,
  discountValue: arbDiscountValue,
});

/**
 * Generator for a list of applied vouchers with at most 1 per type
 * (valid stacking state — simulates a real transaction that followed stacking rules).
 */
const arbValidAppliedVouchers = fc
  .subarray(allVoucherTypes, { minLength: 0, maxLength: 3 })
  .chain((types) =>
    fc.tuple(
      ...types.map((type) =>
        fc.record({
          code: arbVoucherCode,
          type: fc.constant(type),
          discountValue: arbDiscountValue,
        }),
      ),
    ),
  ) as fc.Arbitrary<AppliedVoucher[]>;

describe('canStackVoucher - Property-Based Tests', () => {
  describe('Property 11: Voucher Stacking Limit', () => {
    it('rejects a voucher when one of the same type is already applied', () => {
      fc.assert(
        fc.property(
          arbVoucherType,
          arbAppliedVoucher,
          fc.array(arbAppliedVoucher, { minLength: 0, maxLength: 2 }),
          (voucherType, existingOfSameType, otherVouchers) => {
            // Ensure at least one voucher of the same type exists in applied list
            const applied: AppliedVoucher[] = [
              { ...existingOfSameType, type: voucherType },
              ...otherVouchers,
            ];

            const result = canStackVoucher(voucherType, applied);

            expect(result.allowed).toBe(false);
            expect(result.reason).toBeDefined();
          },
        ),
        { numRuns: 200 },
      );
    });

    it('allows a voucher when no voucher of the same type is already applied', () => {
      fc.assert(
        fc.property(
          arbVoucherType,
          arbValidAppliedVouchers,
          (voucherType, applied) => {
            // Filter out any vouchers of the same type to guarantee precondition
            const appliedWithoutSameType = applied.filter((v) => v.type !== voucherType);

            const result = canStackVoucher(voucherType, appliedWithoutSameType);

            expect(result.allowed).toBe(true);
            expect(result.reason).toBeUndefined();
          },
        ),
        { numRuns: 200 },
      );
    });

    it('rejects all types when all 3 slots are filled (1 FIXED + 1 PERCENTAGE + 1 SERVICE_PACK)', () => {
      fc.assert(
        fc.property(
          arbVoucherType,
          arbVoucherCode,
          arbDiscountValue,
          arbVoucherCode,
          arbDiscountValue,
          arbVoucherCode,
          arbDiscountValue,
          (anyType, code1, val1, code2, val2, code3, val3) => {
            const fullApplied: AppliedVoucher[] = [
              { code: code1, type: VoucherType.Fixed, discountValue: val1 },
              { code: code2, type: VoucherType.Percentage, discountValue: val2 },
              { code: code3, type: VoucherType.ServicePack, discountValue: val3 },
            ];

            const result = canStackVoucher(anyType, fullApplied);

            // All 3 slots occupied → any new voucher rejected
            expect(result.allowed).toBe(false);
            expect(result.reason).toBeDefined();
          },
        ),
        { numRuns: 200 },
      );
    });

    it('rejection reason mentions the type of conflict', () => {
      fc.assert(
        fc.property(
          arbVoucherType,
          arbVoucherCode,
          arbDiscountValue,
          (voucherType, code, discountValue) => {
            const applied: AppliedVoucher[] = [{ code, type: voucherType, discountValue }];

            const result = canStackVoucher(voucherType, applied);

            expect(result.allowed).toBe(false);
            expect(result.reason).toBeDefined();
            // Reason should mention the voucher type (case-insensitive check)
            const typeLabel = voucherType.toUpperCase();
            expect(result.reason!.toUpperCase()).toContain(typeLabel);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
