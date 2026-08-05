/**
 * Void / cancel confirmation for POS.
 *
 * - Required reason textarea
 * - 6-digit admin PIN input (shown when requiresPin=true)
 * - Warning message for paid orders
 * - Confirm and Dismiss buttons
 *
 * Styling note: this used to be written entirely in BEM classes
 * (`void-dialog__*`) that no stylesheet in the app ever defined, so it rendered
 * as a wall of unstyled text — no card, no visual hierarchy, and two buttons
 * ("Cancel" to back out vs "Confirm Void" to destroy the order) that looked
 * identical and read as near-synonyms. That is what made the cancel flow
 * unclear (AIRIN-146). It now uses the same design-system utilities as the rest
 * of the POS, states plainly which order is affected and what will happen, and
 * labels the back-out button "Keep order" so the two actions can't be confused.
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
  /**
   * Called when the cashier taps "Request Admin PIN" — should call the
   * backend to generate + email a one-time PIN to the tenant owner. Omit to
   * hide the button (e.g. when requiresPin is always false for this caller).
   */
  onRequestPin?: () => void;
  /** Status of the last requestPin call, drives the button/status text. */
  pinRequestStatus?: 'idle' | 'sending' | 'sent' | 'error';
  /**
   * What is being voided/cancelled, e.g. "ORD-20260805-003 · Rp 349.000".
   * Shown under the title so the cashier can see they are about to kill the
   * right order — the dialog previously named no order at all.
   */
  subject?: string;
  /** i18n text overrides — all default to English so existing callers keep working untranslated. */
  labels?: {
    title?: string;
    intro?: string;
    reasonLabel?: string;
    reasonPlaceholder?: string;
    confirm?: string;
    dismiss?: string;
    reasonRequired?: string;
    pinRequired?: string;
    pinInvalid?: string;
    requestPin?: string;
    requestPinSending?: string;
    requestPinSent?: string;
    requestPinFailed?: string;
    pinLabel?: string;
    pinPlaceholder?: string;
  };
}

export function VoidDialog({
  requiresPin,
  isPaidOrder,
  onConfirm,
  onCancel,
  onRequestPin,
  pinRequestStatus = 'idle',
  subject,
  labels,
}: VoidDialogProps) {
  const L = {
    title: labels?.title ?? 'Void Order',
    intro: labels?.intro
      ?? (isPaidOrder
        ? 'This order has been paid. Voiding it reverses the sale and any membership usage it consumed.'
        : 'This cancels the order before payment. It stays on record as cancelled and cannot be reopened.'),
    reasonLabel: labels?.reasonLabel ?? 'Reason',
    reasonPlaceholder: labels?.reasonPlaceholder ?? 'Enter reason for voiding this order',
    confirm: labels?.confirm ?? 'Confirm Void',
    dismiss: labels?.dismiss ?? 'Keep order',
    reasonRequired: labels?.reasonRequired ?? 'A reason is required to void an order',
    pinRequired: labels?.pinRequired ?? 'Admin PIN is required',
    pinInvalid: labels?.pinInvalid ?? 'PIN must be exactly 6 digits',
    requestPin: labels?.requestPin ?? 'Request Admin PIN',
    requestPinSending: labels?.requestPinSending ?? 'Sending…',
    requestPinSent: labels?.requestPinSent ?? 'PIN sent to owner’s email.',
    requestPinFailed: labels?.requestPinFailed ?? 'Failed to send PIN',
    pinLabel: labels?.pinLabel ?? 'Admin PIN',
    pinPlaceholder: labels?.pinPlaceholder ?? 'Enter the 6-digit PIN from the email',
  };
  const [reason, setReason] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(() => {
    // Validate reason
    if (!reason.trim()) {
      setError(L.reasonRequired);
      return;
    }

    // Validate PIN when required
    if (requiresPin) {
      if (!adminPin) {
        setError(L.pinRequired);
        return;
      }
      if (adminPin.length !== ADMIN_PIN_LENGTH || !/^\d+$/.test(adminPin)) {
        setError(L.pinInvalid);
        return;
      }
    }

    setError(null);
    onConfirm({
      reason: reason.trim(),
      adminPin: requiresPin ? adminPin : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- L is derived from props each render; only its message strings are read here
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
      className="card w-full"
      role="dialog"
      aria-labelledby="void-dialog-title"
      aria-modal="true"
      data-testid="void-dialog"
    >
      <div>
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 shrink-0 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-lg" aria-hidden="true">!</span>
          <div className="min-w-0">
            <h2 id="void-dialog-title" className="text-lg font-semibold text-text-primary" data-testid="void-dialog-title">
              {L.title}
            </h2>
            {subject && <p className="text-xs text-text-muted mt-0.5 break-words" data-testid="void-subject">{subject}</p>}
          </div>
        </div>

        <p className="text-sm text-text-secondary mt-3">{L.intro}</p>

        {/* Paid order warning */}
        {isPaidOrder && (
          <div
            className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800"
            role="alert"
            data-testid="void-paid-warning"
          >
            {VOID_PAID_WARNING_MESSAGE}
          </div>
        )}

        {/* Reason textarea */}
        <div className="mt-4">
          <label htmlFor="void-reason" className="block text-sm font-medium text-text-primary mb-1.5">
            {L.reasonLabel} <span aria-label="required" className="text-red-600">*</span>
          </label>
          <textarea
            id="void-reason"
            className="input-field"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder={L.reasonPlaceholder}
            rows={3}
            aria-required="true"
            data-testid="void-reason-input"
          />
        </div>

        {/* PIN input (conditional) */}
        {requiresPin && (
          <div className="mt-4" data-testid="void-pin-section">
            <label htmlFor="void-pin" className="block text-sm font-medium text-text-primary mb-1.5">
              {L.pinLabel} <span aria-label="required" className="text-red-600">*</span>
            </label>
            <input
              id="void-pin"
              type="password"
              className="input-field tracking-[0.4em]"
              value={adminPin}
              onChange={handlePinChange}
              placeholder={L.pinPlaceholder}
              maxLength={6}
              inputMode="numeric"
              pattern="\d{6}"
              aria-required="true"
              data-testid="void-pin-input"
            />
            {onRequestPin && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={onRequestPin}
                  disabled={pinRequestStatus === 'sending'}
                  data-testid="void-request-pin-btn"
                >
                  {pinRequestStatus === 'sending' ? L.requestPinSending : L.requestPin}
                </button>
                {pinRequestStatus === 'sent' && (
                  <span className="text-xs text-green-700" role="status" data-testid="void-pin-request-sent">
                    {L.requestPinSent}
                  </span>
                )}
                {pinRequestStatus === 'error' && (
                  <span className="text-xs text-red-600" role="alert" data-testid="void-pin-request-error">
                    {L.requestPinFailed}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700" role="alert" data-testid="void-error">
            {error}
          </div>
        )}

        {/* Action buttons. The destructive one is visually distinct and second,
            so "get me out of here" is never the riskier tap. */}
        <div className="flex justify-end gap-2 mt-5" data-testid="void-actions">
          <button
            className="btn-secondary"
            onClick={onCancel}
            aria-label="Cancel void"
            data-testid="void-cancel-btn"
          >
            {L.dismiss}
          </button>
          <button
            className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-300"
            onClick={handleConfirm}
            aria-label="Confirm void"
            data-testid="void-confirm-btn"
          >
            {L.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
