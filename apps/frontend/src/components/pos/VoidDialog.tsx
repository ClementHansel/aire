/**
 * Void Dialog component for POS.
 * Handles void confirmation with:
 * - Required reason textarea
 * - 6-digit admin PIN input (shown when requiresPin=true)
 * - Warning message for paid orders
 * - Confirm and Cancel buttons
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4
 */
'use client';

import React, { useCallback, useState } from 'react';
import { ADMIN_PIN_LENGTH } from '@aire/shared/constants';
import { VOID_PAID_WARNING_MESSAGE } from '@aire/shared/void';

export interface VoidDialogProps {
  /** Whether the void requires admin PIN (after free void window) */
  requiresPin: boolean;
  /** Whether the order has already been paid (shows refund warning) */
  isPaidOrder: boolean;
  /** Called when void is confirmed with reason and optional PIN */
  onConfirm: (data: { reason: string; adminPin?: string }) => void;
  /** Called when void is cancelled */
  onCancel: () => void;
}

export function VoidDialog({
  requiresPin,
  isPaidOrder,
  onConfirm,
  onCancel,
}: VoidDialogProps) {
  const [reason, setReason] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(() => {
    // Validate reason
    if (!reason.trim()) {
      setError('A reason is required to void an order');
      return;
    }

    // Validate PIN when required
    if (requiresPin) {
      if (!adminPin) {
        setError('Admin PIN is required');
        return;
      }
      if (adminPin.length !== ADMIN_PIN_LENGTH || !/^\d+$/.test(adminPin)) {
        setError('PIN must be exactly 6 digits');
        return;
      }
    }

    setError(null);
    onConfirm({
      reason: reason.trim(),
      adminPin: requiresPin ? adminPin : undefined,
    });
  }, [reason, adminPin, requiresPin, onConfirm]);

  const handlePinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow digits, max 6 characters
    if (/^\d{0,6}$/.test(value)) {
      setAdminPin(value);
      setError(null);
    }
  }, []);

  return (
    <div
      className="void-dialog"
      role="dialog"
      aria-labelledby="void-dialog-title"
      aria-modal="true"
      data-testid="void-dialog"
    >
      <div className="void-dialog__content">
        {/* Header */}
        <h2 id="void-dialog-title" className="void-dialog__title" data-testid="void-dialog-title">
          Void Order
        </h2>

        {/* Paid order warning */}
        {isPaidOrder && (
          <div
            className="void-dialog__warning"
            role="alert"
            data-testid="void-paid-warning"
          >
            {VOID_PAID_WARNING_MESSAGE}
          </div>
        )}

        {/* Reason textarea */}
        <div className="void-dialog__field">
          <label htmlFor="void-reason" className="void-dialog__label">
            Reason <span aria-label="required">*</span>
          </label>
          <textarea
            id="void-reason"
            className="void-dialog__textarea"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="Enter reason for voiding this order"
            rows={3}
            aria-required="true"
            data-testid="void-reason-input"
          />
        </div>

        {/* PIN input (conditional) */}
        {requiresPin && (
          <div className="void-dialog__field" data-testid="void-pin-section">
            <label htmlFor="void-pin" className="void-dialog__label">
              Admin PIN <span aria-label="required">*</span>
            </label>
            <input
              id="void-pin"
              type="password"
              className="void-dialog__pin-input"
              value={adminPin}
              onChange={handlePinChange}
              placeholder="Enter 6-digit PIN"
              maxLength={6}
              inputMode="numeric"
              pattern="\d{6}"
              aria-required="true"
              data-testid="void-pin-input"
            />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="void-dialog__error" role="alert" data-testid="void-error">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="void-dialog__actions" data-testid="void-actions">
          <button
            className="void-dialog__cancel-btn"
            onClick={onCancel}
            aria-label="Cancel void"
            data-testid="void-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="void-dialog__confirm-btn"
            onClick={handleConfirm}
            aria-label="Confirm void"
            data-testid="void-confirm-btn"
          >
            Confirm Void
          </button>
        </div>
      </div>
    </div>
  );
}
