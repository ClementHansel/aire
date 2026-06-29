/**
 * Unit tests for PaymentWindow component.
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentWindow } from './PaymentWindow';
import { PaymentMethod } from '@aire/shared/enums';

describe('PaymentWindow', () => {
  const defaultProps = {
    orderTotal: 100_000,
    onPaymentConfirmed: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onPaymentConfirmed.mockClear();
    defaultProps.onCancel.mockClear();
  });

  describe('Requirement 8.1: Five payment methods supported', () => {
    it('should display all five payment method tabs', () => {
      render(<PaymentWindow {...defaultProps} />);

      expect(screen.getByTestId('method-tab-cash')).toBeDefined();
      expect(screen.getByTestId('method-tab-qris_static')).toBeDefined();
      expect(screen.getByTestId('method-tab-qris_dynamic')).toBeDefined();
      expect(screen.getByTestId('method-tab-edc')).toBeDefined();
      expect(screen.getByTestId('method-tab-transfer')).toBeDefined();
    });

    it('should default to Cash method', () => {
      render(<PaymentWindow {...defaultProps} />);

      expect(screen.getByTestId('method-tab-cash').getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId('payment-cash')).toBeDefined();
    });

    it('should display total amount', () => {
      render(<PaymentWindow {...defaultProps} />);

      expect(screen.getByTestId('payment-total').textContent).toContain('100,000');
    });
  });

  describe('Requirement 8.2: Cash payment', () => {
    it('should display amount input and quick-tender buttons', () => {
      render(<PaymentWindow {...defaultProps} />);

      expect(screen.getByTestId('cash-amount-input')).toBeDefined();
      expect(screen.getByTestId('quick-tender-buttons')).toBeDefined();
    });

    it('should display quick-tender buttons including Exact', () => {
      render(<PaymentWindow {...defaultProps} />);

      expect(screen.getByTestId('quick-tender-exact')).toBeDefined();
      expect(screen.getByTestId('quick-tender-rp-150-000')).toBeDefined();
      expect(screen.getByTestId('quick-tender-rp-200-000')).toBeDefined();
    });

    it('should fill amount when quick-tender Exact is clicked', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('quick-tender-exact'));

      const input = screen.getByTestId('cash-amount-input') as HTMLInputElement;
      expect(input.value).toBe('100000');
    });

    it('should fill amount when quick-tender Rp 150.000 is clicked', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('quick-tender-rp-150-000'));

      const input = screen.getByTestId('cash-amount-input') as HTMLInputElement;
      expect(input.value).toBe('150000');
    });

    it('should display change amount in green when amount exceeds total', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('quick-tender-rp-200-000'));

      const changeDisplay = screen.getByTestId('change-display');
      expect(changeDisplay).toBeDefined();
      expect(changeDisplay.style.color).toBe('green');
      expect(screen.getByTestId('change-amount').textContent).toContain('100,000');
    });

    it('should not display change when amount is less than total', () => {
      render(<PaymentWindow {...defaultProps} />);

      const input = screen.getByTestId('cash-amount-input');
      fireEvent.change(input, { target: { value: '50000' } });

      expect(screen.queryByTestId('change-display')).toBeNull();
    });

    it('should confirm cash payment when amount >= total', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('quick-tender-exact'));
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).toHaveBeenCalledTimes(1);
      const result = defaultProps.onPaymentConfirmed.mock.calls[0][0];
      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Cash);
      expect(result.changeAmount).toBe(0);
    });

    it('should show error when cash amount is insufficient', () => {
      render(<PaymentWindow {...defaultProps} />);

      const input = screen.getByTestId('cash-amount-input');
      fireEvent.change(input, { target: { value: '50000' } });
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).not.toHaveBeenCalled();
      expect(screen.getByTestId('payment-error')).toBeDefined();
    });

    it('should show error when no amount entered for cash', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).not.toHaveBeenCalled();
      expect(screen.getByTestId('payment-error')).toBeDefined();
    });

    it('should calculate change correctly with quick-tender Rp 150.000', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('quick-tender-rp-150-000'));
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).toHaveBeenCalledTimes(1);
      const result = defaultProps.onPaymentConfirmed.mock.calls[0][0];
      expect(result.confirmed).toBe(true);
      expect(result.changeAmount).toBe(50_000);
    });
  });

  describe('Requirement 8.3: QRIS Static payment', () => {
    it('should display QR code when selected', () => {
      render(
        <PaymentWindow
          {...defaultProps}
          qrisStaticUrl="https://example.com/qr-static.png"
        />,
      );

      fireEvent.click(screen.getByTestId('method-tab-qris_static'));

      expect(screen.getByTestId('payment-qris-static')).toBeDefined();
      expect(screen.getByTestId('qris-static-image')).toBeDefined();
    });

    it('should display placeholder when no QR URL', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-qris_static'));

      expect(screen.getByTestId('qris-static-placeholder')).toBeDefined();
    });

    it('should show "Tandai Sudah Bayar" confirm button', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-qris_static'));

      const btn = screen.getByTestId('payment-confirm-btn');
      expect(btn.textContent).toBe('Tandai Sudah Bayar');
    });

    it('should confirm on manual button click', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-qris_static'));
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).toHaveBeenCalledTimes(1);
      const result = defaultProps.onPaymentConfirmed.mock.calls[0][0];
      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.QrisStatic);
    });
  });

  describe('Requirement 8.4: QRIS Dynamic payment', () => {
    it('should display dynamic QR code when selected', () => {
      render(
        <PaymentWindow
          {...defaultProps}
          qrisDynamicUrl="https://example.com/qr-dynamic.png"
        />,
      );

      fireEvent.click(screen.getByTestId('method-tab-qris_dynamic'));

      expect(screen.getByTestId('payment-qris-dynamic')).toBeDefined();
      expect(screen.getByTestId('qris-dynamic-image')).toBeDefined();
    });

    it('should show waiting message when not yet confirmed', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-qris_dynamic'));

      expect(screen.getByTestId('qris-dynamic-waiting')).toBeDefined();
    });

    it('should not show confirm button for QRIS Dynamic', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-qris_dynamic'));

      expect(screen.queryByTestId('payment-confirm-btn')).toBeNull();
    });

    it('should auto-confirm when webhook confirms payment', () => {
      const { rerender } = render(
        <PaymentWindow {...defaultProps} qrisDynamicConfirmed={false} />,
      );

      fireEvent.click(screen.getByTestId('method-tab-qris_dynamic'));

      rerender(
        <PaymentWindow {...defaultProps} qrisDynamicConfirmed={true} />,
      );

      expect(defaultProps.onPaymentConfirmed).toHaveBeenCalledTimes(1);
      const result = defaultProps.onPaymentConfirmed.mock.calls[0][0];
      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.QrisDynamic);
    });

    it('should display confirmed message when payment confirmed', () => {
      render(
        <PaymentWindow {...defaultProps} qrisDynamicConfirmed={true} />,
      );

      fireEvent.click(screen.getByTestId('method-tab-qris_dynamic'));

      expect(screen.getByTestId('qris-dynamic-confirmed-msg')).toBeDefined();
    });
  });

  describe('Requirement 8.5: EDC payment', () => {
    it('should display reference number input when EDC selected', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-edc'));

      expect(screen.getByTestId('payment-edc')).toBeDefined();
      expect(screen.getByTestId('edc-reference-input')).toBeDefined();
    });

    it('should confirm with valid reference number', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-edc'));
      const input = screen.getByTestId('edc-reference-input');
      fireEvent.change(input, { target: { value: '123456' } });
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).toHaveBeenCalledTimes(1);
      const result = defaultProps.onPaymentConfirmed.mock.calls[0][0];
      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Edc);
    });

    it('should show error when reference is empty', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-edc'));
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).not.toHaveBeenCalled();
      expect(screen.getByTestId('payment-error')).toBeDefined();
    });
  });

  describe('Requirement 8.6: Transfer payment', () => {
    it('should display reference number input when Transfer selected', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-transfer'));

      expect(screen.getByTestId('payment-transfer')).toBeDefined();
      expect(screen.getByTestId('transfer-reference-input')).toBeDefined();
    });

    it('should confirm with valid reference number', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-transfer'));
      const input = screen.getByTestId('transfer-reference-input');
      fireEvent.change(input, { target: { value: '7890' } });
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).toHaveBeenCalledTimes(1);
      const result = defaultProps.onPaymentConfirmed.mock.calls[0][0];
      expect(result.confirmed).toBe(true);
      expect(result.method).toBe(PaymentMethod.Transfer);
    });

    it('should show error when reference is empty', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('method-tab-transfer'));
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));

      expect(defaultProps.onPaymentConfirmed).not.toHaveBeenCalled();
      expect(screen.getByTestId('payment-error')).toBeDefined();
    });
  });

  describe('Method switching', () => {
    it('should reset state when switching methods', () => {
      render(<PaymentWindow {...defaultProps} />);

      // Enter cash amount
      const cashInput = screen.getByTestId('cash-amount-input');
      fireEvent.change(cashInput, { target: { value: '200000' } });

      // Switch to EDC
      fireEvent.click(screen.getByTestId('method-tab-edc'));

      // Switch back to cash - should be reset
      fireEvent.click(screen.getByTestId('method-tab-cash'));

      const input = screen.getByTestId('cash-amount-input') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should clear error when switching methods', () => {
      render(<PaymentWindow {...defaultProps} />);

      // Trigger error
      fireEvent.click(screen.getByTestId('payment-confirm-btn'));
      expect(screen.getByTestId('payment-error')).toBeDefined();

      // Switch method
      fireEvent.click(screen.getByTestId('method-tab-edc'));

      expect(screen.queryByTestId('payment-error')).toBeNull();
    });
  });

  describe('Cancel', () => {
    it('should call onCancel when cancel button is clicked', () => {
      render(<PaymentWindow {...defaultProps} />);

      fireEvent.click(screen.getByTestId('payment-cancel-btn'));

      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    });

    it('should not render cancel button when onCancel is not provided', () => {
      render(<PaymentWindow orderTotal={100_000} onPaymentConfirmed={vi.fn()} />);

      expect(screen.queryByTestId('payment-cancel-btn')).toBeNull();
    });
  });

  describe('Quick-tender visibility', () => {
    it('should not show Rp 150.000 quick-tender if total > 150000', () => {
      render(<PaymentWindow {...defaultProps} orderTotal={200_000} />);

      expect(screen.queryByTestId('quick-tender-rp-150-000')).toBeNull();
      expect(screen.queryByTestId('quick-tender-rp-200-000')).toBeDefined();
    });

    it('should not show Rp 200.000 quick-tender if total > 200000', () => {
      render(<PaymentWindow {...defaultProps} orderTotal={250_000} />);

      expect(screen.queryByTestId('quick-tender-rp-150-000')).toBeNull();
      expect(screen.queryByTestId('quick-tender-rp-200-000')).toBeNull();
      // Exact should always be present
      expect(screen.getByTestId('quick-tender-exact')).toBeDefined();
    });
  });
});
