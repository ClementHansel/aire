/**
 * Payment processing logic for the AIRE Operations Platform.
 *
 * Handles pure payment validation and confirmation logic for all supported methods:
 * - Cash: validates amount received >= order total, calculates change
 * - QRIS Static: manual confirmation by Cashier ("Tandai Sudah Bayar")
 * - QRIS Dynamic: validates intent (actual confirmation via webhook externally)
 * - EDC: validates reference number (trace/slip number)
 * - Transfer: validates reference number (last 4 digits or transfer reference)
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { PaymentMethod } from '../enums';
import {
  ERR_PAYMENT_AMOUNT_INSUFFICIENT,
  ERR_PAYMENT_REFERENCE_REQUIRED,
  ERR_PAYMENT_METHOD_INVALID,
} from '../error-codes';

/**
 * Input data required to process a payment.
 */
export interface PaymentProcessInput {
  /** The selected payment method */
  method: PaymentMethod;
  /** The total order amount to be paid */
  orderTotal: number;
  /** Amount received from customer (required for cash) */
  amountReceived?: number;
  /** Reference number for EDC (trace/slip) or Transfer (last 4 digits) */
  referenceNumber?: string;
}

/**
 * Result of payment processing.
 */
export interface PaymentProcessResult {
  /** Whether the payment is confirmed */
  confirmed: boolean;
  /** The payment method used */
  method: PaymentMethod;
  /** Change to return to customer (cash only) */
  changeAmount?: number;
  /** Error details if payment is not confirmed */
  error?: { code: string; message: string };
}

/**
 * A quick-tender option displayed to the Cashier for cash payments.
 */
export interface QuickTenderOption {
  /** Display label (e.g., "Exact", "Rp 150.000") */
  label: string;
  /** The tender amount in the smallest unit */
  amount: number;
}

/**
 * Processes a payment and returns the confirmation result.
 *
 * Logic per method:
 * - Cash: amountReceived must be >= orderTotal → confirmed, change = amountReceived - orderTotal
 * - Cash without amountReceived or < orderTotal → error: ERR_PAYMENT_AMOUNT_INSUFFICIENT
 * - QRIS Static: always confirmed (manual confirmation by Cashier)
 * - QRIS Dynamic: confirmed (validates intent; actual confirmation via webhook externally)
 * - EDC: referenceNumber must be non-empty → confirmed
 * - Transfer: referenceNumber must be non-empty → confirmed
 * - EDC/Transfer without reference → error: ERR_PAYMENT_REFERENCE_REQUIRED
 *
 * @param input - Payment processing input data
 * @returns Payment processing result
 */
export function processPayment(input: PaymentProcessInput): PaymentProcessResult {
  const { method, orderTotal, amountReceived, referenceNumber } = input;

  switch (method) {
    case PaymentMethod.Cash:
      return processCashPayment(orderTotal, amountReceived);

    case PaymentMethod.QrisStatic:
      return {
        confirmed: true,
        method: PaymentMethod.QrisStatic,
      };

    case PaymentMethod.QrisDynamic:
      return {
        confirmed: true,
        method: PaymentMethod.QrisDynamic,
      };

    case PaymentMethod.Edc:
      return processReferencePayment(PaymentMethod.Edc, referenceNumber);

    case PaymentMethod.Transfer:
      return processReferencePayment(PaymentMethod.Transfer, referenceNumber);

    case PaymentMethod.CreditCard:
      return processReferencePayment(PaymentMethod.CreditCard, referenceNumber);

    default:
      return {
        confirmed: false,
        method,
        error: {
          code: ERR_PAYMENT_METHOD_INVALID,
          message: 'Unsupported payment method',
        },
      };
  }
}

/**
 * Processes a cash payment.
 * Validates that amountReceived >= orderTotal and calculates change.
 */
function processCashPayment(
  orderTotal: number,
  amountReceived: number | undefined,
): PaymentProcessResult {
  if (amountReceived === undefined || amountReceived === null) {
    return {
      confirmed: false,
      method: PaymentMethod.Cash,
      error: {
        code: ERR_PAYMENT_AMOUNT_INSUFFICIENT,
        message: 'Amount received is required for cash payment',
      },
    };
  }

  if (amountReceived < orderTotal) {
    return {
      confirmed: false,
      method: PaymentMethod.Cash,
      error: {
        code: ERR_PAYMENT_AMOUNT_INSUFFICIENT,
        message: `Amount received (${amountReceived}) is less than order total (${orderTotal})`,
      },
    };
  }

  return {
    confirmed: true,
    method: PaymentMethod.Cash,
    changeAmount: amountReceived - orderTotal,
  };
}

/**
 * Processes a reference-based payment (EDC or Transfer).
 * Validates that referenceNumber is provided and non-empty.
 */
function processReferencePayment(
  method: PaymentMethod.Edc | PaymentMethod.Transfer | PaymentMethod.CreditCard,
  referenceNumber: string | undefined,
): PaymentProcessResult {
  if (!referenceNumber || referenceNumber.trim().length === 0) {
    return {
      confirmed: false,
      method,
      error: {
        code: ERR_PAYMENT_REFERENCE_REQUIRED,
        message: 'Reference number is required',
      },
    };
  }

  return {
    confirmed: true,
    method,
  };
}

/**
 * Returns quick-tender button options for cash payments.
 *
 * Options:
 * - "Exact": the exact order total
 * - "Rp 150.000": 150,000
 * - "Rp 200.000": 200,000
 *
 * Only includes denominations that are >= the order total (except "Exact" which is always included).
 *
 * @param orderTotal - The total order amount
 * @returns Array of quick-tender options
 */
export function getQuickTenderOptions(orderTotal: number): QuickTenderOption[] {
  const options: QuickTenderOption[] = [
    { label: 'Exact', amount: orderTotal },
  ];

  if (150_000 >= orderTotal) {
    options.push({ label: 'Rp 150.000', amount: 150_000 });
  }

  if (200_000 >= orderTotal) {
    options.push({ label: 'Rp 200.000', amount: 200_000 });
  }

  return options;
}
