import { describe, it, expect } from 'vitest';
import { isNonEmptyString, validateOrder, OrderValidationInput } from './index';
import {
  ERR_ORDER_CUSTOMER_NAME_REQUIRED,
  ERR_ORDER_CUSTOMER_PHONE_INVALID,
  ERR_ORDER_CART_EMPTY,
  ERR_ORDER_NO_MAIN_SERVICE,
  ERR_ORDER_VOUCHER_MIN_ORDER,
  ERR_ORDER_PLATE_SELECTION_REQUIRED,
} from '../error-codes';

// ─── isNonEmptyString ─────────────────────────────────────────────────────────

describe('isNonEmptyString', () => {
  it('should return true for non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('should return false for empty strings', () => {
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('should return false for non-string values', () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
  });
});

// ─── validateOrder ────────────────────────────────────────────────────────────

describe('validateOrder', () => {
  const validInput: OrderValidationInput = {
    customerName: 'John Doe',
    customerPhone: '081234567890',
    items: [{ serviceId: 'svc-1', quantity: 1, isMainService: true }],
  };

  describe('valid orders', () => {
    it('should return valid for a complete valid order', () => {
      const result = validateOrder(validInput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid with optional fields present', () => {
      const result = validateOrder({
        ...validInput,
        voucherCodes: ['VOUCHER1'],
        voucherMinOrderAmount: 50000,
        orderSubtotal: 100000,
        memberPlates: ['B1234ABC'],
        selectedPlate: 'B1234ABC',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid when member has only one plate (no selection required)', () => {
      const result = validateOrder({
        ...validInput,
        memberPlates: ['B1234ABC'],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Rule 1: Customer name required', () => {
    it('should error when name is empty string', () => {
      const result = validateOrder({ ...validInput, customerName: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_CUSTOMER_NAME_REQUIRED,
        message: 'Name is required',
        field: 'customerName',
      });
    });

    it('should error when name is whitespace only', () => {
      const result = validateOrder({ ...validInput, customerName: '   ' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_CUSTOMER_NAME_REQUIRED,
        message: 'Name is required',
        field: 'customerName',
      });
    });
  });

  describe('Rule 2: Customer phone validation', () => {
    it('should error when phone has fewer than 8 digits', () => {
      const result = validateOrder({ ...validInput, customerPhone: '0812345' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_CUSTOMER_PHONE_INVALID,
        message: 'Phone must be at least 8 digits',
        field: 'customerPhone',
      });
    });

    it('should error when phone is empty', () => {
      const result = validateOrder({ ...validInput, customerPhone: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_CUSTOMER_PHONE_INVALID,
        message: 'Phone must be at least 8 digits',
        field: 'customerPhone',
      });
    });

    it('should pass when phone has exactly 8 digits', () => {
      const result = validateOrder({ ...validInput, customerPhone: '08123456' });
      expect(result.valid).toBe(true);
    });

    it('should count only digits (ignore formatting)', () => {
      // "081-234-56" has 8 digits
      const result = validateOrder({ ...validInput, customerPhone: '081-234-56' });
      expect(result.valid).toBe(true);
    });

    it('should error when phone has non-digit characters and fewer than 8 digits total', () => {
      // "+62-12" → digits: 6212 → 4 digits total
      const result = validateOrder({ ...validInput, customerPhone: '+62-12' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_CUSTOMER_PHONE_INVALID,
        message: 'Phone must be at least 8 digits',
        field: 'customerPhone',
      });
    });
  });

  describe('Rule 3: Cart must not be empty', () => {
    it('should error when items array is empty', () => {
      const result = validateOrder({ ...validInput, items: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_CART_EMPTY,
        message: 'Add at least one service',
        field: 'items',
      });
    });
  });

  describe('Rule 4: Cart must have a main service', () => {
    it('should error when no item is a main service', () => {
      const result = validateOrder({
        ...validInput,
        items: [
          { serviceId: 'addon-1', quantity: 1, isMainService: false },
          { serviceId: 'addon-2', quantity: 2, isMainService: false },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_NO_MAIN_SERVICE,
        message: 'Add a main wash service first',
        field: 'items',
      });
    });

    it('should not produce "no main service" error when cart is empty (cart empty error already covers it)', () => {
      const result = validateOrder({ ...validInput, items: [] });
      const noMainServiceError = result.errors.find(
        (e) => e.code === ERR_ORDER_NO_MAIN_SERVICE,
      );
      expect(noMainServiceError).toBeUndefined();
    });
  });

  describe('Rule 5: Voucher minimum order amount', () => {
    it('should error when subtotal is below voucher minimum', () => {
      const result = validateOrder({
        ...validInput,
        voucherCodes: ['DISC10'],
        voucherMinOrderAmount: 100000,
        orderSubtotal: 50000,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_VOUCHER_MIN_ORDER,
        message: 'Minimum order amount not met',
        field: 'voucherCodes',
      });
    });

    it('should pass when subtotal equals voucher minimum', () => {
      const result = validateOrder({
        ...validInput,
        voucherCodes: ['DISC10'],
        voucherMinOrderAmount: 100000,
        orderSubtotal: 100000,
      });
      expect(result.valid).toBe(true);
    });

    it('should pass when subtotal exceeds voucher minimum', () => {
      const result = validateOrder({
        ...validInput,
        voucherCodes: ['DISC10'],
        voucherMinOrderAmount: 100000,
        orderSubtotal: 150000,
      });
      expect(result.valid).toBe(true);
    });

    it('should not check voucher minimum when no voucher codes are provided', () => {
      const result = validateOrder({
        ...validInput,
        voucherMinOrderAmount: 100000,
        orderSubtotal: 0,
      });
      expect(result.valid).toBe(true);
    });

    it('should not check voucher minimum when voucherMinOrderAmount is 0', () => {
      const result = validateOrder({
        ...validInput,
        voucherCodes: ['DISC10'],
        voucherMinOrderAmount: 0,
        orderSubtotal: 0,
      });
      expect(result.valid).toBe(true);
    });

    it('should treat missing orderSubtotal as 0', () => {
      const result = validateOrder({
        ...validInput,
        voucherCodes: ['DISC10'],
        voucherMinOrderAmount: 50000,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_VOUCHER_MIN_ORDER,
        message: 'Minimum order amount not met',
        field: 'voucherCodes',
      });
    });
  });

  describe('Rule 6: Multi-plate member must select a plate', () => {
    it('should error when member has multiple plates but none selected', () => {
      const result = validateOrder({
        ...validInput,
        memberPlates: ['B1234ABC', 'B5678DEF'],
        selectedPlate: undefined,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_PLATE_SELECTION_REQUIRED,
        message: 'Select vehicle plate',
        field: 'selectedPlate',
      });
    });

    it('should error when member has multiple plates and selectedPlate is empty', () => {
      const result = validateOrder({
        ...validInput,
        memberPlates: ['B1234ABC', 'B5678DEF'],
        selectedPlate: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_PLATE_SELECTION_REQUIRED,
        message: 'Select vehicle plate',
        field: 'selectedPlate',
      });
    });

    it('should error when member has multiple plates and selectedPlate is whitespace', () => {
      const result = validateOrder({
        ...validInput,
        memberPlates: ['B1234ABC', 'B5678DEF'],
        selectedPlate: '   ',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        code: ERR_ORDER_PLATE_SELECTION_REQUIRED,
        message: 'Select vehicle plate',
        field: 'selectedPlate',
      });
    });

    it('should pass when member has multiple plates and one is selected', () => {
      const result = validateOrder({
        ...validInput,
        memberPlates: ['B1234ABC', 'B5678DEF'],
        selectedPlate: 'B1234ABC',
      });
      expect(result.valid).toBe(true);
    });

    it('should not require plate selection when memberPlates is undefined', () => {
      const result = validateOrder(validInput);
      expect(result.valid).toBe(true);
    });

    it('should not require plate selection when memberPlates is empty', () => {
      const result = validateOrder({
        ...validInput,
        memberPlates: [],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('multiple errors', () => {
    it('should return ALL errors at once for an invalid order', () => {
      const result = validateOrder({
        customerName: '',
        customerPhone: '123',
        items: [],
        voucherCodes: ['V1'],
        voucherMinOrderAmount: 50000,
        orderSubtotal: 0,
        memberPlates: ['P1', 'P2'],
        selectedPlate: '',
      });

      expect(result.valid).toBe(false);
      // Should have: name required, phone invalid, cart empty, voucher min, plate selection
      // Note: no main service error is skipped when cart is empty
      expect(result.errors).toHaveLength(5);

      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain(ERR_ORDER_CUSTOMER_NAME_REQUIRED);
      expect(errorCodes).toContain(ERR_ORDER_CUSTOMER_PHONE_INVALID);
      expect(errorCodes).toContain(ERR_ORDER_CART_EMPTY);
      expect(errorCodes).toContain(ERR_ORDER_VOUCHER_MIN_ORDER);
      expect(errorCodes).toContain(ERR_ORDER_PLATE_SELECTION_REQUIRED);
    });

    it('should return both cart empty and no main service when items have no main service', () => {
      const result = validateOrder({
        customerName: '',
        customerPhone: '',
        items: [{ serviceId: 'addon-1', quantity: 1, isMainService: false }],
      });

      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain(ERR_ORDER_CUSTOMER_NAME_REQUIRED);
      expect(errorCodes).toContain(ERR_ORDER_CUSTOMER_PHONE_INVALID);
      expect(errorCodes).toContain(ERR_ORDER_NO_MAIN_SERVICE);
      // Cart is NOT empty (has 1 item), so no cart empty error
      expect(errorCodes).not.toContain(ERR_ORDER_CART_EMPTY);
    });
  });

  describe('data preservation on validation failure', () => {
    it('should not mutate the input object', () => {
      const input: OrderValidationInput = {
        customerName: '',
        customerPhone: '123',
        items: [{ serviceId: 'svc-1', quantity: 2, isMainService: false }],
        voucherCodes: ['V1'],
        voucherMinOrderAmount: 50000,
        orderSubtotal: 10000,
        memberPlates: ['P1', 'P2'],
        selectedPlate: '',
      };

      const inputCopy = JSON.parse(JSON.stringify(input));
      validateOrder(input);

      // Input should remain unchanged (cart/customer data preserved)
      expect(input).toEqual(inputCopy);
    });
  });
});
