import { describe, it, expect } from 'vitest';
import {
  processPayment,
  getQuickTenderOptions,
  PaymentProcessInput,
} from './payment-handler';
import { PaymentMethod } from '../enums';
import {
  ERR_PAYMENT_AMOUNT_INSUFFICIENT,
  ERR_PAYMENT_REFERENCE_REQUIRED,
  ERR_PAYMENT_METHOD_INVALID,
} from '../error-codes';

/** Helper to create a base payment input */
function makeInput(overrides: Partial<PaymentProcessInput> = {}): PaymentProcessInput {
  return {
    method: PaymentMethod.Cash,
    orderTotal: 100_000,
    ...overrides,
  };
}

describe('processPayment', () => {
  describe('Cash payment (Req 8.2)', () => {
    it('confirms when amountReceived equals orderTotal (exact)', () => {
      const input = makeInput({
        method: PaymentMethod.Cash,
        orderTotal: 75_000,
        amountReceived: 75_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Cash);
      expect(result.changeAmount).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('confirms and calculates change when amountReceived > orderTotal', () => {
      const input = makeInput({
        method: PaymentMethod.Cash,
        orderTotal: 75_000,
        amountReceived: 100_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Cash);
      expect(result.changeAmount).toBe(25_000);
    });

    it('rejects when amountReceived < orderTotal', () => {
      const input = makeInput({
        method: PaymentMethod.Cash,
        orderTotal: 100_000,
        amountReceived: 50_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_AMOUNT_INSUFFICIENT);
    });

    it('rejects when amountReceived is not provided', () => {
      const input = makeInput({
        method: PaymentMethod.Cash,
        orderTotal: 100_000,
        amountReceived: undefined,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_AMOUNT_INSUFFICIENT);
    });

    it('confirms with zero change when amountReceived exactly matches', () => {
      const input = makeInput({
        method: PaymentMethod.Cash,
        orderTotal: 150_000,
        amountReceived: 150_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.changeAmount).toBe(0);
    });
  });

  describe('QRIS Static payment (Req 8.3)', () => {
    it('always confirms (manual Cashier confirmation)', () => {
      const input = makeInput({
        method: PaymentMethod.QrisStatic,
        orderTotal: 100_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.QrisStatic);
      expect(result.changeAmount).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('QRIS Dynamic payment (Req 8.4)', () => {
    it('confirms intent (webhook handles actual confirmation)', () => {
      const input = makeInput({
        method: PaymentMethod.QrisDynamic,
        orderTotal: 100_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.QrisDynamic);
      expect(result.changeAmount).toBeUndefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('EDC payment (Req 8.5)', () => {
    it('confirms with valid reference number', () => {
      const input = makeInput({
        method: PaymentMethod.Edc,
        orderTotal: 100_000,
        referenceNumber: '123456',
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Edc);
      expect(result.error).toBeUndefined();
    });

    it('rejects when reference number is empty', () => {
      const input = makeInput({
        method: PaymentMethod.Edc,
        orderTotal: 100_000,
        referenceNumber: '',
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_REFERENCE_REQUIRED);
    });

    it('rejects when reference number is whitespace only', () => {
      const input = makeInput({
        method: PaymentMethod.Edc,
        orderTotal: 100_000,
        referenceNumber: '   ',
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_REFERENCE_REQUIRED);
    });

    it('rejects when reference number is not provided', () => {
      const input = makeInput({
        method: PaymentMethod.Edc,
        orderTotal: 100_000,
        referenceNumber: undefined,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_REFERENCE_REQUIRED);
    });
  });

  describe('Transfer payment (Req 8.6)', () => {
    it('confirms with valid reference number', () => {
      const input = makeInput({
        method: PaymentMethod.Transfer,
        orderTotal: 100_000,
        referenceNumber: '7890',
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Transfer);
      expect(result.error).toBeUndefined();
    });

    it('rejects when reference number is empty', () => {
      const input = makeInput({
        method: PaymentMethod.Transfer,
        orderTotal: 100_000,
        referenceNumber: '',
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_REFERENCE_REQUIRED);
    });

    it('rejects when reference number is whitespace only', () => {
      const input = makeInput({
        method: PaymentMethod.Transfer,
        orderTotal: 100_000,
        referenceNumber: '  \t  ',
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_REFERENCE_REQUIRED);
    });

    it('rejects when reference number is not provided', () => {
      const input = makeInput({
        method: PaymentMethod.Transfer,
        orderTotal: 100_000,
        referenceNumber: undefined,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_REFERENCE_REQUIRED);
    });
  });

  describe('payment confirmation transitions order to PAID (Req 8.7)', () => {
    it('every confirmed payment returns confirmed: true for state transition', () => {
      const methods = [
        { method: PaymentMethod.Cash, amountReceived: 100_000 },
        { method: PaymentMethod.QrisStatic },
        { method: PaymentMethod.QrisDynamic },
        { method: PaymentMethod.Edc, referenceNumber: 'REF001' },
        { method: PaymentMethod.Transfer, referenceNumber: '1234' },
      ];

      for (const override of methods) {
        const input = makeInput({ orderTotal: 100_000, ...override });
        const result = processPayment(input);
        expect(result.confirmed).toBe(true);
      }
    });
  });

  describe('invalid payment method', () => {
    it('rejects with ERR_PAYMENT_METHOD_INVALID for unknown method', () => {
      const input = makeInput({
        method: 'crypto' as PaymentMethod,
        orderTotal: 100_000,
      });
      const result = processPayment(input);

      expect(result.confirmed).toBe(false);
      expect(result.error?.code).toBe(ERR_PAYMENT_METHOD_INVALID);
    });
  });
});

describe('getQuickTenderOptions', () => {
  it('returns Exact, 150k, 200k for order total <= 150k', () => {
    const options = getQuickTenderOptions(75_000);

    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({ label: 'Exact', amount: 75_000 });
    expect(options[1]).toEqual({ label: 'Rp 150.000', amount: 150_000 });
    expect(options[2]).toEqual({ label: 'Rp 200.000', amount: 200_000 });
  });

  it('returns Exact and 200k when order total is between 150k and 200k', () => {
    const options = getQuickTenderOptions(175_000);

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ label: 'Exact', amount: 175_000 });
    expect(options[1]).toEqual({ label: 'Rp 200.000', amount: 200_000 });
  });

  it('returns only Exact when order total > 200k', () => {
    const options = getQuickTenderOptions(250_000);

    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({ label: 'Exact', amount: 250_000 });
  });

  it('returns all options when order total equals 150k', () => {
    const options = getQuickTenderOptions(150_000);

    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({ label: 'Exact', amount: 150_000 });
    expect(options[1]).toEqual({ label: 'Rp 150.000', amount: 150_000 });
    expect(options[2]).toEqual({ label: 'Rp 200.000', amount: 200_000 });
  });

  it('returns Exact and 200k when order total equals 200k', () => {
    const options = getQuickTenderOptions(200_000);

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ label: 'Exact', amount: 200_000 });
    expect(options[1]).toEqual({ label: 'Rp 200.000', amount: 200_000 });
  });

  it('always includes Exact as first option', () => {
    const totals = [10_000, 50_000, 100_000, 300_000];
    for (const total of totals) {
      const options = getQuickTenderOptions(total);
      expect(options[0].label).toBe('Exact');
      expect(options[0].amount).toBe(total);
    }
  });
});
