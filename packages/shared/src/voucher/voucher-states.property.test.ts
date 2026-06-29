import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { VoucherType } from '../enums';
import { VoucherData, VoucherEvaluationContext, VoucherState, evaluateVoucher } from './index';

/**
 * Property-based tests for voucher state error messages.
 *
 * **Validates: Requirements 17.6, 17.7, 17.8, 17.9, 17.10**
 */

// --- Arbitrary Generators ---

/** All valid VoucherState status values */
const VALID_STATUSES: VoucherState['status'][] = [
  'valid_applicable',
  'valid_not_applicable',
  'not_found',
  'fully_redeemed',
  'expired',
  'not_yet_active',
  'parent_code',
  'inactive',
];

/** Generates a valid ISO date string (YYYY-MM-DD) */
const arbIsoDate: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });

/** Generates a nullable ISO date */
const arbNullableIsoDate: fc.Arbitrary<string | null> = fc.option(arbIsoDate, { nil: null });

/** Generates a VoucherType enum value */
const arbVoucherType: fc.Arbitrary<VoucherType> = fc.constantFrom(
  VoucherType.Fixed,
  VoucherType.Percentage,
  VoucherType.ServicePack,
);

/** Generates a nullable array of string IDs */
const arbNullableStringArray: fc.Arbitrary<string[] | null> = fc.option(
  fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
  { nil: null },
);

/** Generates an arbitrary VoucherData object */
const arbVoucherData: fc.Arbitrary<VoucherData> = fc.record({
  type: arbVoucherType,
  value: fc.integer({ min: 0, max: 500000 }),
  maxUses: fc.integer({ min: 1, max: 100 }),
  currentUses: fc.integer({ min: 0, max: 150 }),
  startDate: arbNullableIsoDate,
  expiryDate: arbNullableIsoDate,
  outletIds: arbNullableStringArray,
  brandScope: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 15 }), { minLength: 1, maxLength: 5 }), {
    nil: null,
  }),
  serviceIds: arbNullableStringArray,
  minOrderAmount: fc.integer({ min: 0, max: 500000 }),
  isActive: fc.boolean(),
  isParentCode: fc.boolean(),
});

/** Generates a VoucherData | null (including the null case) */
const arbVoucherOrNull: fc.Arbitrary<VoucherData | null> = fc.option(arbVoucherData, { nil: null });

/** Generates a VoucherEvaluationContext */
const arbContext: fc.Arbitrary<VoucherEvaluationContext> = fc.record({
  outletId: fc.uuid(),
  vehicleBrand: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: undefined }),
  serviceIdsInCart: fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
  orderSubtotal: fc.integer({ min: 0, max: 1000000 }),
  currentDate: arbIsoDate,
});

describe('Voucher State Error Messages - Property-Based Tests', () => {
  describe('Property 13: Voucher State Error Messages', () => {
    it('mutual exclusivity: evaluateVoucher always returns exactly one valid status', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);

          // The result must have a status field with exactly one of the defined values
          expect(VALID_STATUSES).toContain(result.status);
        }),
        { numRuns: 500 },
      );
    });

    it('exhaustiveness: every VoucherData/context combination maps to one of the defined states', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);

          // The function must never throw and must always return a valid state
          expect(result).toBeDefined();
          expect(result).not.toBeNull();
          expect(typeof result.status).toBe('string');
          expect(VALID_STATUSES).toContain(result.status);
        }),
        { numRuns: 500 },
      );
    });

    it('determinism: same input always produces the same output', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result1 = evaluateVoucher(voucher, context);
          const result2 = evaluateVoucher(voucher, context);

          expect(result1).toEqual(result2);
        }),
        { numRuns: 500 },
      );
    });

    it('priority: null voucher always returns not_found regardless of context', () => {
      fc.assert(
        fc.property(arbContext, (context) => {
          const result = evaluateVoucher(null, context);

          expect(result).toEqual({ status: 'not_found' });
        }),
        { numRuns: 200 },
      );
    });

    it('priority: isParentCode always returns parent_code regardless of other fields', () => {
      // Generate voucher data that always has isParentCode = true, but vary all other fields
      const arbParentVoucher = arbVoucherData.map((v) => ({ ...v, isParentCode: true }));

      fc.assert(
        fc.property(arbParentVoucher, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);

          expect(result).toEqual({ status: 'parent_code' });
        }),
        { numRuns: 300 },
      );
    });

    it('state-specific structure: valid_applicable includes type and discountValue', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);

          if (result.status === 'valid_applicable') {
            expect(result).toHaveProperty('type');
            expect(result).toHaveProperty('discountValue');
            expect(Object.values(VoucherType)).toContain(result.type);
            expect(typeof result.discountValue).toBe('number');
          }
        }),
        { numRuns: 500 },
      );
    });

    it('state-specific structure: valid_not_applicable includes type, discountValue, and reason', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);

          if (result.status === 'valid_not_applicable') {
            expect(result).toHaveProperty('type');
            expect(result).toHaveProperty('discountValue');
            expect(result).toHaveProperty('reason');
            expect(Object.values(VoucherType)).toContain(result.type);
            expect(typeof result.discountValue).toBe('number');
            expect(typeof result.reason).toBe('string');
            expect(result.reason.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('state-specific structure: not_yet_active includes startDate', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);

          if (result.status === 'not_yet_active') {
            expect(result).toHaveProperty('startDate');
            expect(typeof result.startDate).toBe('string');
            expect(result.startDate.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('state-specific structure: error states (not_found, fully_redeemed, expired, parent_code, inactive) are plain objects', () => {
      fc.assert(
        fc.property(arbVoucherOrNull, arbContext, (voucher, context) => {
          const result = evaluateVoucher(voucher, context);
          const plainStatuses = ['not_found', 'fully_redeemed', 'expired', 'parent_code', 'inactive'];

          if (plainStatuses.includes(result.status)) {
            if (result.status === 'not_found') {
              expect(Object.keys(result)).toEqual(['status']);
            }
            if (result.status === 'fully_redeemed') {
              expect(Object.keys(result)).toEqual(['status']);
            }
            if (result.status === 'expired') {
              expect(Object.keys(result)).toEqual(['status']);
            }
            if (result.status === 'parent_code') {
              expect(Object.keys(result)).toEqual(['status']);
            }
            if (result.status === 'inactive') {
              expect(Object.keys(result)).toEqual(['status']);
            }
          }
        }),
        { numRuns: 500 },
      );
    });
  });
});
