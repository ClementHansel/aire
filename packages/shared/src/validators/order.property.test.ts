import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateOrder, OrderValidationInput } from './index';
import { MIN_PHONE_LENGTH } from '../constants';
import {
  ERR_ORDER_CUSTOMER_NAME_REQUIRED,
  ERR_ORDER_CUSTOMER_PHONE_INVALID,
  ERR_ORDER_CART_EMPTY,
  ERR_ORDER_NO_MAIN_SERVICE,
  ERR_ORDER_VOUCHER_MIN_ORDER,
  ERR_ORDER_PLATE_SELECTION_REQUIRED,
} from '../error-codes';

/**
 * Property-based tests for order validation completeness.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
 */

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a non-empty trimmed name */
const validName = fc
  .stringOf(fc.char().filter((c) => c.trim().length > 0), { minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** Generates an empty or whitespace-only name (violates Rule 1) */
const invalidName = fc.constantFrom('', '   ', '\t', '\n');

/** Generates a phone string with at least MIN_PHONE_LENGTH digits */
const validPhone = fc
  .integer({ min: MIN_PHONE_LENGTH, max: 15 })
  .chain((len) =>
    fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
      minLength: len,
      maxLength: len,
    }),
  );

/** Generates a phone string with fewer than MIN_PHONE_LENGTH digits (violates Rule 2) */
const invalidPhone = fc
  .integer({ min: 0, max: MIN_PHONE_LENGTH - 1 })
  .chain((len) =>
    len === 0
      ? fc.constant('')
      : fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
          minLength: len,
          maxLength: len,
        }),
  );

/** Generates a valid cart item */
const cartItem = (isMain: boolean) =>
  fc.record({
    serviceId: fc.uuid(),
    quantity: fc.integer({ min: 1, max: 10 }),
    isMainService: fc.constant(isMain),
  });

/** Generates a non-empty cart with at least one main service */
const validCart = fc
  .array(cartItem(false), { minLength: 0, maxLength: 5 })
  .chain((addons) =>
    fc.array(cartItem(true), { minLength: 1, maxLength: 3 }).map((mains) => [...mains, ...addons]),
  );

/** Generates a non-empty cart with NO main service (violates Rule 4) */
const cartWithoutMainService = fc.array(cartItem(false), { minLength: 1, maxLength: 5 });

/** Generates an empty cart (violates Rule 3) */
const emptyCart = fc.constant([] as Array<{ serviceId: string; quantity: number; isMainService: boolean }>);

/** Generates a valid order where all rules are satisfied */
const validOrderArb: fc.Arbitrary<OrderValidationInput> = fc
  .tuple(validName, validPhone, validCart)
  .map(([name, phone, items]) => ({
    customerName: name,
    customerPhone: phone,
    items,
  }));

/** Generates a valid order with voucher that meets minimum */
const validOrderWithVoucherArb: fc.Arbitrary<OrderValidationInput> = fc
  .tuple(
    validName,
    validPhone,
    validCart,
    fc.integer({ min: 1000, max: 500000 }),
  )
  .map(([name, phone, items, minAmount]) => ({
    customerName: name,
    customerPhone: phone,
    items,
    voucherCodes: ['VOUCHER1'],
    voucherMinOrderAmount: minAmount,
    orderSubtotal: minAmount + fc.sample(fc.integer({ min: 0, max: 100000 }), 1)[0],
  }));

/** Alphanumeric character arbitrary */
const alphanumChar = fc.constantFrom(
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(''),
);

/** Generates a valid order with multi-plate member where plate is selected */
const validOrderWithPlatesArb: fc.Arbitrary<OrderValidationInput> = fc
  .tuple(
    validName,
    validPhone,
    validCart,
    fc.array(fc.stringOf(alphanumChar, { minLength: 4, maxLength: 10 }), { minLength: 2, maxLength: 5 }),
  )
  .map(([name, phone, items, plates]) => ({
    customerName: name,
    customerPhone: phone,
    items,
    memberPlates: plates,
    selectedPlate: plates[0],
  }));

// ─── Known error codes mapped to rules ────────────────────────────────────────

const ALL_ERROR_CODES = [
  ERR_ORDER_CUSTOMER_NAME_REQUIRED,
  ERR_ORDER_CUSTOMER_PHONE_INVALID,
  ERR_ORDER_CART_EMPTY,
  ERR_ORDER_NO_MAIN_SERVICE,
  ERR_ORDER_VOUCHER_MIN_ORDER,
  ERR_ORDER_PLATE_SELECTION_REQUIRED,
] as const;

// ─── Helper: check which rules are violated ───────────────────────────────────

function computeViolations(input: OrderValidationInput): Set<string> {
  const violations = new Set<string>();

  // Rule 1: name empty
  if (!input.customerName || input.customerName.trim().length === 0) {
    violations.add(ERR_ORDER_CUSTOMER_NAME_REQUIRED);
  }

  // Rule 2: phone < 8 digits
  const phoneDigits = (input.customerPhone || '').replace(/\D/g, '');
  if (phoneDigits.length < MIN_PHONE_LENGTH) {
    violations.add(ERR_ORDER_CUSTOMER_PHONE_INVALID);
  }

  // Rule 3: cart empty
  if (!input.items || input.items.length === 0) {
    violations.add(ERR_ORDER_CART_EMPTY);
  }

  // Rule 4: no main service (only when cart is non-empty)
  if (input.items && input.items.length > 0) {
    if (!input.items.some((item) => item.isMainService)) {
      violations.add(ERR_ORDER_NO_MAIN_SERVICE);
    }
  }

  // Rule 5: voucher min not met
  if (
    input.voucherCodes &&
    input.voucherCodes.length > 0 &&
    input.voucherMinOrderAmount !== undefined &&
    input.voucherMinOrderAmount > 0
  ) {
    const subtotal = input.orderSubtotal ?? 0;
    if (subtotal < input.voucherMinOrderAmount) {
      violations.add(ERR_ORDER_VOUCHER_MIN_ORDER);
    }
  }

  // Rule 6: multi-plate member, no plate selected
  if (input.memberPlates && input.memberPlates.length > 1) {
    if (!input.selectedPlate || input.selectedPlate.trim().length === 0) {
      violations.add(ERR_ORDER_PLATE_SELECTION_REQUIRED);
    }
  }

  return violations;
}

// ─── Arbitrary for fully random orders (both valid and invalid) ───────────────

const arbitraryOrderInput: fc.Arbitrary<OrderValidationInput> = fc.record({
  customerName: fc.oneof(validName, invalidName, fc.constant('')),
  customerPhone: fc.oneof(validPhone, invalidPhone),
  items: fc.oneof(
    validCart,
    cartWithoutMainService,
    emptyCart,
  ),
  voucherCodes: fc.option(fc.array(fc.hexaString({ minLength: 4, maxLength: 10 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
  voucherMinOrderAmount: fc.option(fc.integer({ min: 0, max: 500000 }), { nil: undefined }),
  orderSubtotal: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
  memberPlates: fc.option(
    fc.array(fc.stringOf(alphanumChar, { minLength: 3, maxLength: 10 }), { minLength: 0, maxLength: 5 }),
    { nil: undefined },
  ),
  selectedPlate: fc.option(fc.oneof(
    fc.stringOf(alphanumChar, { minLength: 3, maxLength: 10 }),
    fc.constant(''),
    fc.constant('   '),
  ), { nil: undefined }),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateOrder - Property-Based Tests', () => {
  describe('Property 7: Order Validation Completeness', () => {
    it('Completeness: if ALL conditions are satisfied, validation passes', () => {
      fc.assert(
        fc.property(validOrderArb, (input) => {
          const result = validateOrder(input);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 300 },
      );
    });

    it('Completeness: valid order with voucher meeting minimum passes', () => {
      fc.assert(
        fc.property(
          validName,
          validPhone,
          validCart,
          fc.integer({ min: 1000, max: 500000 }),
          fc.integer({ min: 0, max: 500000 }),
          (name, phone, items, minAmount, extra) => {
            const input: OrderValidationInput = {
              customerName: name,
              customerPhone: phone,
              items,
              voucherCodes: ['VOUCHER1'],
              voucherMinOrderAmount: minAmount,
              orderSubtotal: minAmount + extra,
            };
            const result = validateOrder(input);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('Completeness: valid order with multi-plate member and plate selected passes', () => {
      fc.assert(
        fc.property(validOrderWithPlatesArb, (input) => {
          const result = validateOrder(input);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 200 },
      );
    });

    it('Soundness: if validation rejects, at least one rule violation exists', () => {
      fc.assert(
        fc.property(arbitraryOrderInput, (input) => {
          const result = validateOrder(input);
          if (!result.valid) {
            const violations = computeViolations(input);
            expect(violations.size).toBeGreaterThan(0);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('Biconditional: valid === true if and only if no rule is violated', () => {
      fc.assert(
        fc.property(arbitraryOrderInput, (input) => {
          const result = validateOrder(input);
          const violations = computeViolations(input);

          if (violations.size === 0) {
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          } else {
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('Error specificity: each error corresponds to exactly one violated rule', () => {
      fc.assert(
        fc.property(arbitraryOrderInput, (input) => {
          const result = validateOrder(input);
          const violations = computeViolations(input);

          // Every error code returned must be a known code and must correspond to a violation
          for (const error of result.errors) {
            expect(ALL_ERROR_CODES).toContain(error.code);
            expect(violations.has(error.code)).toBe(true);
          }

          // Every violation must have a corresponding error in the result
          for (const violation of violations) {
            const hasError = result.errors.some((e) => e.code === violation);
            expect(hasError).toBe(true);
          }

          // No duplicate error codes
          const codes = result.errors.map((e) => e.code);
          const uniqueCodes = new Set(codes);
          expect(uniqueCodes.size).toBe(codes.length);
        }),
        { numRuns: 500 },
      );
    });

    it('Data preservation: input object is never mutated on validation', () => {
      fc.assert(
        fc.property(arbitraryOrderInput, (input) => {
          const deepCopy = JSON.parse(JSON.stringify(input));
          validateOrder(input);
          expect(input).toEqual(deepCopy);
        }),
        { numRuns: 300 },
      );
    });

    it('Boundary: phone with exactly MIN_PHONE_LENGTH digits passes phone validation', () => {
      fc.assert(
        fc.property(
          validName,
          validCart,
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: MIN_PHONE_LENGTH,
            maxLength: MIN_PHONE_LENGTH,
          }),
          (name, items, phone) => {
            const input: OrderValidationInput = {
              customerName: name,
              customerPhone: phone,
              items,
            };
            const result = validateOrder(input);
            // Should not have phone error
            const phoneError = result.errors.find(
              (e) => e.code === ERR_ORDER_CUSTOMER_PHONE_INVALID,
            );
            expect(phoneError).toBeUndefined();
          },
        ),
        { numRuns: 200 },
      );
    });

    it('Boundary: phone with MIN_PHONE_LENGTH - 1 digits fails phone validation', () => {
      fc.assert(
        fc.property(
          validName,
          validCart,
          fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: MIN_PHONE_LENGTH - 1,
            maxLength: MIN_PHONE_LENGTH - 1,
          }),
          (name, items, phone) => {
            const input: OrderValidationInput = {
              customerName: name,
              customerPhone: phone,
              items,
            };
            const result = validateOrder(input);
            const phoneError = result.errors.find(
              (e) => e.code === ERR_ORDER_CUSTOMER_PHONE_INVALID,
            );
            expect(phoneError).toBeDefined();
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
