/**
 * OrderCard component for POS Orders tab.
 * Displays a single order with: order number, customer name, brand chip(s),
 * operator name, status badge (color-coded), item list, promo chips, and total.
 * Supports settle (Cash/QRIS) for unpaid orders and receipt reprint action.
 *
 * Requirements: 20.2, 20.5, 20.6, 20.7
 */
'use client';

import React, { useCallback, useState } from 'react';
import { OrderStatus, PaymentMethod } from '@aire/shared/enums';
import type { OrderCard as OrderCardData, OrderCardItem } from '@aire/shared/interfaces/order';

/** Promo chip types displayed on order cards */
export type PromoChipType = 'member' | 'voucher' | 'sold_membership' | 'campaign';

export interface OrderCardProps {
  /** Order data to display */
  order: OrderCardData;
  /** Promo chips for this order (member, voucher, sold membership, campaign) */
  promoChips?: PromoChipType[];
  /** Called when user wants to settle an unpaid order */
  onSettle?: (orderId: string, method: PaymentMethod.Cash | PaymentMethod.QrisStatic) => void;
  /** Called when user wants to reprint receipt */
  onReceiptReprint?: (orderId: string) => void;
  /** Called when user wants to void the order */
  onVoid?: (orderId: string) => void;
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  [OrderStatus.Ordered]: '#f59e0b',    // amber - unpaid
  [OrderStatus.Paid]: '#3b82f6',       // blue - paid
  [OrderStatus.Confirmed]: '#8b5cf6',  // purple - confirmed
  [OrderStatus.Completed]: '#10b981',  // green - completed
  [OrderStatus.Cancelled]: '#ef4444',  // red - cancelled
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.Ordered]: 'Ordered',
  [OrderStatus.Paid]: 'Paid',
  [OrderStatus.Confirmed]: 'Confirmed',
  [OrderStatus.Completed]: 'Completed',
  [OrderStatus.Cancelled]: 'Cancelled',
};

const PROMO_CHIP_LABELS: Record<PromoChipType, string> = {
  member: 'Member',
  voucher: 'Voucher',
  sold_membership: 'Sold: Membership',
  campaign: 'Campaign',
};

export function OrderCard({
  order,
  promoChips = [],
  onSettle,
  onVoid,
  onReceiptReprint,
}: OrderCardProps) {
  const [showSettleOptions, setShowSettleOptions] = useState(false);

  const isUnpaid = order.status === OrderStatus.Ordered;
  const canVoid =
    order.status === OrderStatus.Ordered ||
    order.status === OrderStatus.Paid ||
    order.status === OrderStatus.Completed;

  const handleSettleClick = useCallback(() => {
    setShowSettleOptions(true);
  }, []);

  const handleSettleMethod = useCallback(
    (method: PaymentMethod.Cash | PaymentMethod.QrisStatic) => {
      onSettle?.(order.id, method);
      setShowSettleOptions(false);
    },
    [onSettle, order.id],
  );

  const handleCancelSettle = useCallback(() => {
    setShowSettleOptions(false);
  }, []);

  return (
    <div
      className="order-card"
      data-testid={`order-card-${order.id}`}
      aria-label={`Order ${order.orderNumber}`}
    >
      {/* Header: order number + status badge */}
      <div className="order-card__header">
        <span className="order-card__number" data-testid="order-number">
          #{order.orderNumber}
        </span>
        <span
          className="order-card__status-badge"
          style={{ backgroundColor: STATUS_COLORS[order.status] }}
          data-testid="order-status-badge"
          aria-label={`Status: ${STATUS_LABELS[order.status]}`}
        >
          {STATUS_LABELS[order.status]}
        </span>
      </div>

      {/* Customer info */}
      <div className="order-card__customer">
        <span className="order-card__customer-name" data-testid="order-customer-name">
          {order.customerName}
        </span>
        {order.vehicleBrand && (
          <span className="order-card__brand-chip" data-testid="order-brand-chip">
            {order.vehicleBrand}
          </span>
        )}
      </div>

      {/* Operator */}
      <div className="order-card__operator" data-testid="order-operator">
        Operator: {order.operatorName}
      </div>

      {/* Items list */}
      <div className="order-card__items" data-testid="order-items">
        {order.items.map((item: OrderCardItem, index: number) => (
          <div key={index} className="order-card__item">
            <span className="order-card__item-name">
              {item.quantity}x {item.serviceName}
            </span>
            <span className="order-card__item-subtotal">
              Rp {item.subtotal.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Promo chips */}
      {promoChips.length > 0 && (
        <div className="order-card__promo-chips" data-testid="order-promo-chips">
          {promoChips.map((chip) => (
            <span
              key={chip}
              className={`order-card__promo-chip order-card__promo-chip--${chip}`}
              data-testid={`promo-chip-${chip}`}
            >
              {PROMO_CHIP_LABELS[chip]}
            </span>
          ))}
        </div>
      )}

      {/* Total */}
      <div className="order-card__total" data-testid="order-total">
        <span className="order-card__total-label">Total</span>
        <span className="order-card__total-amount">
          Rp {order.total.toLocaleString()}
        </span>
      </div>

      {/* Actions */}
      <div className="order-card__actions" data-testid="order-actions">
        {/* Settle unpaid - Cash/QRIS only */}
        {isUnpaid && onSettle && !showSettleOptions && (
          <button
            className="order-card__settle-btn"
            onClick={handleSettleClick}
            aria-label="Settle payment"
            data-testid="settle-btn"
          >
            Settle
          </button>
        )}

        {/* Settle method options */}
        {isUnpaid && showSettleOptions && (
          <div className="order-card__settle-options" data-testid="settle-options">
            <button
              className="order-card__settle-method-btn"
              onClick={() => handleSettleMethod(PaymentMethod.Cash)}
              aria-label="Pay with cash"
              data-testid="settle-cash-btn"
            >
              Cash
            </button>
            <button
              className="order-card__settle-method-btn"
              onClick={() => handleSettleMethod(PaymentMethod.QrisStatic)}
              aria-label="Pay with QRIS"
              data-testid="settle-qris-btn"
            >
              QRIS
            </button>
            <button
              className="order-card__settle-cancel-btn"
              onClick={handleCancelSettle}
              aria-label="Cancel settle"
              data-testid="settle-cancel-btn"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Void */}
        {canVoid && onVoid && (
          <button
            className="order-card__void-btn"
            onClick={() => onVoid(order.id)}
            aria-label="Void order"
            data-testid="void-btn"
          >
            Void
          </button>
        )}

        {/* Receipt reprint */}
        {onReceiptReprint && (
          <button
            className="order-card__receipt-btn"
            onClick={() => onReceiptReprint(order.id)}
            aria-label="Reprint receipt"
            data-testid="receipt-btn"
          >
            🧾
          </button>
        )}
      </div>
    </div>
  );
}
