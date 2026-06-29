/**
 * Kiosk Self-Service PWA Interface.
 * Customer-facing interface accessed via QR code for queue status checking.
 *
 * Requirements: 27.1, 27.3 — Self-service kiosk with queue position and wait time display.
 */
'use client';

import React, { useState, useCallback } from 'react';

/** Queue status response from the API */
export interface QueueStatus {
  orderNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  status: 'queued' | 'in_progress' | 'completed' | 'cancelled';
  assignedBay?: string;
}

/** Props for internal testing */
export interface KioskPageProps {
  tenantId?: string;
}

/**
 * Kiosk main page — self-service customer interface.
 * Provides order number input and queue status display.
 */
export default function KioskPage({
  params,
}: {
  params: { tenantId: string };
}) {
  const [orderNumber, setOrderNumber] = useState('');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckQueue = useCallback(async () => {
    if (!orderNumber.trim()) return;

    setLoading(true);
    setError(null);
    setQueueStatus(null);

    try {
      const response = await fetch(
        `/api/kiosk/${params.tenantId}/queue-status?orderNumber=${encodeURIComponent(orderNumber.trim())}`,
      );

      if (!response.ok) {
        if (response.status === 404) {
          setError('Order not found. Please check your order number.');
        } else {
          setError('Unable to check queue status. Please try again.');
        }
        return;
      }

      const data: QueueStatus = await response.json();
      setQueueStatus(data);
    } catch {
      setError('Connection error. Please check your internet and try again.');
    } finally {
      setLoading(false);
    }
  }, [orderNumber, params.tenantId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCheckQueue();
      }
    },
    [handleCheckQueue],
  );

  return (
    <div className="kiosk-page" data-testid="kiosk-page">
      {/* Header */}
      <header className="kiosk-page__header" data-testid="kiosk-header">
        <h1 className="kiosk-page__title">Self-Service Queue Check</h1>
        <p className="kiosk-page__subtitle">
          Enter your order number to check your queue status
        </p>
      </header>

      {/* Order number input */}
      <div className="kiosk-page__input-section" data-testid="input-section">
        <label htmlFor="order-number-input" className="kiosk-page__label">
          Order Number
        </label>
        <input
          id="order-number-input"
          type="text"
          className="kiosk-page__input"
          data-testid="input-order-number"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. ORD-001"
          aria-label="Order number"
          autoComplete="off"
          disabled={loading}
        />
        <button
          className="kiosk-page__btn-check"
          data-testid="btn-check-queue"
          onClick={handleCheckQueue}
          disabled={!orderNumber.trim() || loading}
          aria-label="Check queue status"
        >
          {loading ? 'Checking...' : 'Check Queue'}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          className="kiosk-page__error"
          data-testid="queue-error"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      )}

      {/* Queue status display */}
      {queueStatus && (
        <div
          className="kiosk-page__status"
          data-testid="queue-status"
          role="region"
          aria-label="Queue status information"
        >
          <div className="kiosk-page__status-header">
            <span className="kiosk-page__order-label">Order:</span>
            <span
              className="kiosk-page__order-number"
              data-testid="display-order-number"
            >
              {queueStatus.orderNumber}
            </span>
          </div>

          <div className="kiosk-page__status-grid">
            {/* Position */}
            <div className="kiosk-page__status-item" data-testid="display-position">
              <span className="kiosk-page__status-label">Position</span>
              <span className="kiosk-page__status-value">
                #{queueStatus.position}
              </span>
            </div>

            {/* Estimated Wait Time */}
            <div
              className="kiosk-page__status-item"
              data-testid="display-wait-time"
            >
              <span className="kiosk-page__status-label">Estimated Wait</span>
              <span className="kiosk-page__status-value">
                {queueStatus.estimatedWaitMinutes} min
              </span>
            </div>

            {/* Status */}
            <div className="kiosk-page__status-item" data-testid="display-status">
              <span className="kiosk-page__status-label">Status</span>
              <span
                className={`kiosk-page__status-badge kiosk-page__status-badge--${queueStatus.status}`}
              >
                {formatStatus(queueStatus.status)}
              </span>
            </div>

            {/* Bay (if assigned) */}
            {queueStatus.assignedBay && (
              <div
                className="kiosk-page__status-item"
                data-testid="display-bay"
              >
                <span className="kiosk-page__status-label">Assigned Bay</span>
                <span className="kiosk-page__status-value">
                  {queueStatus.assignedBay}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Format queue status for display */
function formatStatus(status: QueueStatus['status']): string {
  switch (status) {
    case 'queued':
      return 'In Queue';
    case 'in_progress':
      return 'In Progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}
