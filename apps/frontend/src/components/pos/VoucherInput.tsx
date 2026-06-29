/**
 * VoucherInput component for POS new order flow.
 * Provides voucher code entry, validation, status display with blue/orange badges,
 * error states, and removal of applied vouchers.
 *
 * Requirements: 17.1–17.10
 */
'use client';

import React, { useState, useCallback } from 'react';
import { VoucherType } from '@aire/shared/enums';
import { VoucherState } from '@aire/shared/voucher';
import { AppliedVoucher, canStackVoucher } from '@aire/shared/voucher/stacking';

export interface VoucherValidationResult {
  state: VoucherState;
}

export interface VoucherInputProps {
  /** Callback to validate a voucher code (calls backend API) */
  onValidate: (code: string) => Promise<VoucherValidationResult>;
  /** Currently applied vouchers */
  appliedVouchers: AppliedVoucher[];
  /** Callback when a voucher is successfully applied */
  onApply: (voucher: AppliedVoucher) => void;
  /** Callback when a voucher is removed */
  onRemove: (code: string) => void;
  /** Whether the input is disabled (e.g., during processing) */
  disabled?: boolean;
}

/**
 * Maps VoucherState to a user-friendly error message.
 */
function getErrorMessage(state: VoucherState): string {
  switch (state.status) {
    case 'not_found':
    case 'inactive':
      return 'Voucher not found or not active';
    case 'fully_redeemed':
      return 'Voucher fully redeemed';
    case 'expired':
      return 'Voucher expired';
    case 'not_yet_active':
      return `Voucher belum aktif (berlaku mulai ${state.startDate})`;
    case 'parent_code':
      return 'This is a voucher pack — present one of its individual codes';
    default:
      return '';
  }
}

/**
 * Returns a human-readable label for a voucher type.
 */
function getTypeLabel(type: VoucherType): string {
  switch (type) {
    case VoucherType.Fixed:
      return 'FIXED';
    case VoucherType.Percentage:
      return 'PERCENTAGE';
    case VoucherType.ServicePack:
      return 'SERVICE PACK';
    default: {
      const _exhaustive: never = type;
      return String(_exhaustive).toUpperCase();
    }
  }
}

export function VoucherInput({
  onValidate,
  appliedVouchers,
  onApply,
  onRemove,
  disabled = false,
}: VoucherInputProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ type: VoucherType; reason: string } | null>(null);

  const handleApply = useCallback(async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    setError(null);
    setWarning(null);
    setLoading(true);

    try {
      const result = await onValidate(trimmedCode);
      const { state } = result;

      if (state.status === 'valid_applicable') {
        // Check stacking rules
        const stackingResult = canStackVoucher(state.type, appliedVouchers);
        if (!stackingResult.allowed) {
          setError(stackingResult.reason || 'Cannot stack this voucher');
          return;
        }

        onApply({
          code: trimmedCode,
          type: state.type,
          discountValue: state.discountValue,
        });
        setCode('');
      } else if (state.status === 'valid_not_applicable') {
        setWarning({
          type: state.type,
          reason: state.reason,
        });
      } else {
        // Error state
        setError(getErrorMessage(state));
      }
    } catch {
      setError('Failed to validate voucher. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [code, onValidate, appliedVouchers, onApply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !disabled && !loading) {
        handleApply();
      }
    },
    [handleApply, disabled, loading],
  );

  return (
    <div className="voucher-input" data-testid="voucher-input">
      {/* Input field and Apply button */}
      <div className="voucher-input__field-group">
        <label htmlFor="voucher-code" className="voucher-input__label">
          Voucher Code
        </label>
        <div className="voucher-input__input-row">
          <input
            id="voucher-code"
            type="text"
            className="voucher-input__input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
              setWarning(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Enter voucher code"
            disabled={disabled || loading}
            aria-label="Voucher code"
            aria-describedby={error ? 'voucher-error' : undefined}
            data-testid="voucher-code-input"
          />
          <button
            className="voucher-input__apply-btn"
            onClick={handleApply}
            disabled={disabled || loading || !code.trim()}
            aria-label="Apply voucher"
            data-testid="voucher-apply-btn"
          >
            {loading ? 'Validating...' : 'Apply'}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div
          id="voucher-error"
          className="voucher-input__error"
          role="alert"
          data-testid="voucher-error"
        >
          {error}
        </div>
      )}

      {/* Orange badge: valid but not applicable */}
      {warning && (
        <div
          className="voucher-input__warning"
          role="status"
          data-testid="voucher-warning"
        >
          <span
            className="voucher-input__badge voucher-input__badge--orange"
            data-testid="voucher-badge-orange"
          >
            {getTypeLabel(warning.type)}
          </span>
          <span className="voucher-input__warning-reason" data-testid="voucher-warning-reason">
            {warning.reason}
          </span>
        </div>
      )}

      {/* Applied vouchers list */}
      {appliedVouchers.length > 0 && (
        <div className="voucher-input__applied" data-testid="voucher-applied-list">
          {appliedVouchers.map((voucher) => (
            <div
              key={voucher.code}
              className="voucher-input__applied-item"
              data-testid={`voucher-applied-${voucher.code}`}
            >
              <span
                className="voucher-input__badge voucher-input__badge--blue"
                data-testid={`voucher-badge-blue-${voucher.code}`}
              >
                {getTypeLabel(voucher.type)}
              </span>
              <span className="voucher-input__applied-code">{voucher.code}</span>
              <span className="voucher-input__applied-value">
                {voucher.type === VoucherType.Percentage
                  ? `-${voucher.discountValue}%`
                  : voucher.type === VoucherType.Fixed
                    ? `-Rp ${voucher.discountValue.toLocaleString()}`
                    : 'Service Pack'}
              </span>
              <button
                className="voucher-input__remove-btn"
                onClick={() => onRemove(voucher.code)}
                aria-label={`Remove voucher ${voucher.code}`}
                data-testid={`voucher-remove-${voucher.code}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
