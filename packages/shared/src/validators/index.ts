/**
 * Shared validators for the AIRE Operations Platform.
 */

import { MIN_PHONE_LENGTH } from '../constants';
import {
  ERR_ORDER_CUSTOMER_NAME_REQUIRED,
  ERR_ORDER_CUSTOMER_PHONE_INVALID,
  ERR_ORDER_CART_EMPTY,
  ERR_ORDER_NO_MAIN_SERVICE,
  ERR_ORDER_VOUCHER_MIN_ORDER,
  ERR_ORDER_PLATE_SELECTION_REQUIRED,
} from '../error-codes';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface OrderValidationInput {
  customerName: string;
  customerPhone: string;
  items: Array<{ serviceId: string; quantity: number; isMainService: boolean }>;
  voucherCodes?: string[];
  voucherMinOrderAmount?: number;
  orderSubtotal?: number;
  memberPlates?: string[];
  selectedPlate?: string;
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface OrderValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ─── Utility Validators ───────────────────────────────────────────────────────

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ─── Order Validator ──────────────────────────────────────────────────────────

/**
 * Validates an order submission against all business rules.
 * Returns ALL validation errors at once (does not short-circuit).
 *
 * Validation rules:
 * 1. Customer name must not be empty
 * 2. Customer phone must have at least MIN_PHONE_LENGTH digits
 * 3. Cart must have at least one item
 * 4. Cart must contain at least one main service
 * 5. If a voucher has a minimum order amount, the subtotal must meet it
 * 6. If a member has multiple plates, one must be selected
 */
export function validateOrder(input: OrderValidationInput): OrderValidationResult {
  const errors: ValidationError[] = [];

  // Rule 1: Name is required
  if (!input.customerName || input.customerName.trim().length === 0) {
    errors.push({
      code: ERR_ORDER_CUSTOMER_NAME_REQUIRED,
      message: 'Name is required',
      field: 'customerName',
    });
  }

  // Rule 2: Phone must have at least MIN_PHONE_LENGTH digits
  const phoneDigits = (input.customerPhone || '').replace(/\D/g, '');
  if (phoneDigits.length < MIN_PHONE_LENGTH) {
    errors.push({
      code: ERR_ORDER_CUSTOMER_PHONE_INVALID,
      message: 'Phone must be at least 8 digits',
      field: 'customerPhone',
    });
  }

  // Rule 3: Cart must not be empty
  if (!input.items || input.items.length === 0) {
    errors.push({
      code: ERR_ORDER_CART_EMPTY,
      message: 'Add at least one service',
      field: 'items',
    });
  }

  // Rule 4: Cart must contain at least one main service
  if (input.items && input.items.length > 0) {
    const hasMainService = input.items.some((item) => item.isMainService);
    if (!hasMainService) {
      errors.push({
        code: ERR_ORDER_NO_MAIN_SERVICE,
        message: 'Add a main wash service first',
        field: 'items',
      });
    }
  }

  // Rule 5: Voucher minimum order amount check
  if (
    input.voucherCodes &&
    input.voucherCodes.length > 0 &&
    input.voucherMinOrderAmount !== undefined &&
    input.voucherMinOrderAmount > 0
  ) {
    const subtotal = input.orderSubtotal ?? 0;
    if (subtotal < input.voucherMinOrderAmount) {
      errors.push({
        code: ERR_ORDER_VOUCHER_MIN_ORDER,
        message: 'Minimum order amount not met',
        field: 'voucherCodes',
      });
    }
  }

  // Rule 6: Multi-plate member must select a plate
  if (input.memberPlates && input.memberPlates.length > 1) {
    if (!input.selectedPlate || input.selectedPlate.trim().length === 0) {
      errors.push({
        code: ERR_ORDER_PLATE_SELECTION_REQUIRED,
        message: 'Select vehicle plate',
        field: 'selectedPlate',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
