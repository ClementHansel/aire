/**
 * Payment Window component for POS.
 * Handles payment method selection and processing for all supported methods:
 * - Cash: amount input, quick-tender buttons, change display
 * - QRIS Static: QR code display + manual confirm
 * - QRIS Dynamic: QR code display + auto-mark on webhook
 * - EDC: reference number input
 * - Transfer: reference number input
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { PaymentMethod } from '@aire/shared/enums';
import {
  processPayment,
  getQuickTenderOptions,
  PaymentProcessResult,
} from '@aire/shared/payment';

export interface PaymentWindowProps {
  /** Total order amount to be paid */
  orderTotal: number;
  /** Static QR code image URL for QRIS Static */
  qrisStaticUrl?: string;
  /** Dynamic QR code image URL for QRIS Dynamic (generated per transaction) */
  qrisDynamicUrl?: string;
  /** Whether QRIS Dynamic payment has been confirmed via webhook */
  qrisDynamicConfirmed?: boolean;
  /** Called when payment is confirmed */
  onPaymentConfirmed: (result: PaymentProcessResult) => void;
  /** Called when user cancels the payment window */
  onCancel?: () => void;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.Cash]: 'Cash',
  [PaymentMethod.QrisStatic]: 'QRIS Static',
  [PaymentMethod.QrisDynamic]: 'QRIS Dynamic',
  [PaymentMethod.Edc]: 'EDC',
  [PaymentMethod.Transfer]: 'Transfer',
};

const PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.Cash,
  PaymentMethod.QrisStatic,
  PaymentMethod.QrisDynamic,
  PaymentMethod.Edc,
  PaymentMethod.Transfer,
];

export function PaymentWindow({
  orderTotal,
  qrisStaticUrl,
  qrisDynamicUrl,
  qrisDynamicConfirmed,
  onPaymentConfirmed,
  onCancel,
}: PaymentWindowProps) {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(PaymentMethod.Cash);
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const quickTenderOptions = useMemo(
    () => getQuickTenderOptions(orderTotal),
    [orderTotal],
  );

  const changeAmount = useMemo(() => {
    const amount = parseFloat(amountReceived);
    if (isNaN(amount) || amount < orderTotal) return null;
    return amount - orderTotal;
  }, [amountReceived, orderTotal]);

  const handleMethodSelect = useCallback((method: PaymentMethod) => {
    setSelectedMethod(method);
    setAmountReceived('');
    setReferenceNumber('');
    setError(null);
  }, []);

  const handleQuickTender = useCallback((amount: number) => {
    setAmountReceived(amount.toString());
    setError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    const result = processPayment({
      method: selectedMethod,
      orderTotal,
      amountReceived: selectedMethod === PaymentMethod.Cash
        ? (parseFloat(amountReceived) || undefined)
        : undefined,
      referenceNumber: (selectedMethod === PaymentMethod.Edc || selectedMethod === PaymentMethod.Transfer)
        ? referenceNumber
        : undefined,
    });

    if (!result.confirmed) {
      setError(result.error?.message ?? 'Payment failed');
      return;
    }

    onPaymentConfirmed(result);
  }, [selectedMethod, orderTotal, amountReceived, referenceNumber, onPaymentConfirmed]);

  // Auto-confirm QRIS Dynamic when webhook confirms
  React.useEffect(() => {
    if (selectedMethod === PaymentMethod.QrisDynamic && qrisDynamicConfirmed) {
      onPaymentConfirmed({
        confirmed: true,
        method: PaymentMethod.QrisDynamic,
      });
    }
  }, [selectedMethod, qrisDynamicConfirmed, onPaymentConfirmed]);

  return (
    <div className="payment-window" data-testid="payment-window">
      {/* Header */}
      <div className="payment-window__header">
        <h2 className="payment-window__title">Payment</h2>
        <span className="payment-window__total" data-testid="payment-total">
          Total: Rp {orderTotal.toLocaleString()}
        </span>
      </div>

      {/* Payment Method Tabs */}
      <div
        className="payment-window__methods"
        role="tablist"
        aria-label="Payment methods"
        data-testid="payment-methods"
      >
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method}
            role="tab"
            aria-selected={selectedMethod === method}
            className={`payment-window__method-tab ${selectedMethod === method ? 'payment-window__method-tab--active' : ''}`}
            onClick={() => handleMethodSelect(method)}
            data-testid={`method-tab-${method}`}
          >
            {PAYMENT_METHOD_LABELS[method]}
          </button>
        ))}
      </div>

      {/* Payment Method Content */}
      <div className="payment-window__content" data-testid="payment-content">
        {/* Cash */}
        {selectedMethod === PaymentMethod.Cash && (
          <div className="payment-window__cash" data-testid="payment-cash">
            <div className="payment-window__cash-input-group">
              <label htmlFor="amount-received" className="payment-window__label">
                Amount Received
              </label>
              <input
                id="amount-received"
                type="number"
                className="payment-window__input"
                value={amountReceived}
                onChange={(e) => {
                  setAmountReceived(e.target.value);
                  setError(null);
                }}
                placeholder="Enter amount"
                min={0}
                aria-label="Amount received"
                data-testid="cash-amount-input"
              />
            </div>

            {/* Quick-tender buttons */}
            <div className="payment-window__quick-tender" data-testid="quick-tender-buttons">
              {quickTenderOptions.map((option) => (
                <button
                  key={option.label}
                  className="payment-window__quick-tender-btn"
                  onClick={() => handleQuickTender(option.amount)}
                  aria-label={`Quick tender ${option.label}`}
                  data-testid={`quick-tender-${option.label.toLowerCase().replace(/[\s.]/g, '-')}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Change display */}
            {changeAmount !== null && changeAmount >= 0 && (
              <div
                className="payment-window__change"
                style={{ color: 'green' }}
                data-testid="change-display"
              >
                <span className="payment-window__change-label">Change:</span>
                <span className="payment-window__change-amount" data-testid="change-amount">
                  Rp {changeAmount.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* QRIS Static */}
        {selectedMethod === PaymentMethod.QrisStatic && (
          <div className="payment-window__qris-static" data-testid="payment-qris-static">
            <div className="payment-window__qr-container">
              {qrisStaticUrl ? (
                <img
                  src={qrisStaticUrl}
                  alt="QRIS Static QR Code"
                  className="payment-window__qr-image"
                  data-testid="qris-static-image"
                />
              ) : (
                <div className="payment-window__qr-placeholder" data-testid="qris-static-placeholder">
                  QR Code not available
                </div>
              )}
            </div>
            <p className="payment-window__qris-instruction">
              Ask customer to scan QR code, then confirm payment below.
            </p>
          </div>
        )}

        {/* QRIS Dynamic */}
        {selectedMethod === PaymentMethod.QrisDynamic && (
          <div className="payment-window__qris-dynamic" data-testid="payment-qris-dynamic">
            <div className="payment-window__qr-container">
              {qrisDynamicUrl ? (
                <img
                  src={qrisDynamicUrl}
                  alt="QRIS Dynamic QR Code"
                  className="payment-window__qr-image"
                  data-testid="qris-dynamic-image"
                />
              ) : (
                <div className="payment-window__qr-placeholder" data-testid="qris-dynamic-placeholder">
                  Generating QR Code...
                </div>
              )}
            </div>
            {qrisDynamicConfirmed ? (
              <p className="payment-window__qris-confirmed" data-testid="qris-dynamic-confirmed-msg">
                ✓ Payment confirmed
              </p>
            ) : (
              <p className="payment-window__qris-instruction" data-testid="qris-dynamic-waiting">
                Waiting for payment confirmation...
              </p>
            )}
          </div>
        )}

        {/* EDC */}
        {selectedMethod === PaymentMethod.Edc && (
          <div className="payment-window__edc" data-testid="payment-edc">
            <div className="payment-window__reference-group">
              <label htmlFor="edc-reference" className="payment-window__label">
                Reference Number (Trace/Slip Number)
              </label>
              <input
                id="edc-reference"
                type="text"
                className="payment-window__input"
                value={referenceNumber}
                onChange={(e) => {
                  setReferenceNumber(e.target.value);
                  setError(null);
                }}
                placeholder="Enter trace/slip number"
                aria-label="EDC reference number"
                data-testid="edc-reference-input"
              />
            </div>
          </div>
        )}

        {/* Transfer */}
        {selectedMethod === PaymentMethod.Transfer && (
          <div className="payment-window__transfer" data-testid="payment-transfer">
            <div className="payment-window__reference-group">
              <label htmlFor="transfer-reference" className="payment-window__label">
                Reference (Last 4 digits or transfer reference)
              </label>
              <input
                id="transfer-reference"
                type="text"
                className="payment-window__input"
                value={referenceNumber}
                onChange={(e) => {
                  setReferenceNumber(e.target.value);
                  setError(null);
                }}
                placeholder="Enter reference"
                aria-label="Transfer reference number"
                data-testid="transfer-reference-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="payment-window__error" role="alert" data-testid="payment-error">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="payment-window__actions" data-testid="payment-actions">
        {onCancel && (
          <button
            className="payment-window__cancel-btn"
            onClick={onCancel}
            aria-label="Cancel payment"
            data-testid="payment-cancel-btn"
          >
            Cancel
          </button>
        )}
        {/* Confirm button (not shown for QRIS Dynamic - auto-confirmed via webhook) */}
        {selectedMethod !== PaymentMethod.QrisDynamic && (
          <button
            className="payment-window__confirm-btn"
            onClick={handleConfirm}
            aria-label="Confirm payment"
            data-testid="payment-confirm-btn"
          >
            {selectedMethod === PaymentMethod.QrisStatic
              ? 'Tandai Sudah Bayar'
              : 'Confirm Payment'}
          </button>
        )}
      </div>
    </div>
  );
}
