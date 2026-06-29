/**
 * Cart component for POS new order flow.
 * Displays cart items with quantity controls, discounts, summary, and Place Order button.
 *
 * Requirements: 6.7, 6.8, 6.9, 6.10
 */
'use client';

import React, { useCallback } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { ValidationError } from '@aire/shared/validators';

export interface CartProps {
  customerName: string;
  customerPhone: string;
  memberPlates?: string[];
  selectedPlate?: string;
  voucherCodes?: string[];
  voucherMinOrderAmount?: number;
  onPlaceOrder: () => void;
  onValidationErrors?: (errors: ValidationError[]) => void;
}

export function Cart({
  customerName,
  customerPhone,
  memberPlates,
  selectedPlate,
  voucherCodes,
  voucherMinOrderAmount,
  onPlaceOrder,
  onValidationErrors,
}: CartProps) {
  const {
    items,
    note,
    updateQuantity,
    removeItem,
    applyDiscount,
    setNote,
    getSummary,
    validate,
  } = useCartStore();

  const summary = getSummary();

  const handleQuantityChange = useCallback(
    (serviceId: string, delta: number) => {
      const item = items.find((i) => i.serviceId === serviceId);
      if (!item) return;
      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        removeItem(serviceId);
      } else {
        updateQuantity(serviceId, newQty);
      }
    },
    [items, updateQuantity, removeItem],
  );

  const handleDiscountChange = useCallback(
    (serviceId: string, value: string) => {
      const numValue = parseFloat(value) || 0;
      applyDiscount(serviceId, numValue);
    },
    [applyDiscount],
  );

  const handlePlaceOrder = useCallback(() => {
    const result = validate(
      customerName,
      customerPhone,
      memberPlates,
      selectedPlate,
      voucherCodes,
      voucherMinOrderAmount,
    );

    if (!result.valid) {
      onValidationErrors?.(result.errors);
      return;
    }

    onPlaceOrder();
  }, [
    validate,
    customerName,
    customerPhone,
    memberPlates,
    selectedPlate,
    voucherCodes,
    voucherMinOrderAmount,
    onPlaceOrder,
    onValidationErrors,
  ]);

  return (
    <div className="cart" data-testid="cart">
      {/* Cart Items */}
      <div className="cart__items" data-testid="cart-items">
        {items.length === 0 && (
          <p className="cart__empty" data-testid="cart-empty">
            No items in cart
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.serviceId}
            className="cart__item"
            data-testid={`cart-item-${item.serviceId}`}
          >
            <div className="cart__item-info">
              <span className="cart__item-name">{item.serviceName}</span>
              <span className="cart__item-price">
                Rp {(item.unitPrice * item.quantity).toLocaleString()}
              </span>
            </div>

            <div className="cart__item-controls">
              {/* Quantity controls */}
              <div className="cart__quantity" role="group" aria-label={`Quantity for ${item.serviceName}`}>
                <button
                  className="cart__quantity-btn"
                  onClick={() => handleQuantityChange(item.serviceId, -1)}
                  aria-label={`Decrease quantity of ${item.serviceName}`}
                  data-testid={`qty-minus-${item.serviceId}`}
                >
                  −
                </button>
                <span
                  className="cart__quantity-value"
                  aria-label={`Quantity: ${item.quantity}`}
                  data-testid={`qty-value-${item.serviceId}`}
                >
                  {item.quantity}
                </span>
                <button
                  className="cart__quantity-btn"
                  onClick={() => handleQuantityChange(item.serviceId, 1)}
                  aria-label={`Increase quantity of ${item.serviceName}`}
                  data-testid={`qty-plus-${item.serviceId}`}
                >
                  +
                </button>
              </div>

              {/* Manual discount */}
              <div className="cart__discount">
                <label htmlFor={`discount-${item.serviceId}`} className="cart__discount-label">
                  Disc:
                </label>
                <input
                  id={`discount-${item.serviceId}`}
                  type="number"
                  className="cart__discount-input"
                  value={item.discount || ''}
                  onChange={(e) => handleDiscountChange(item.serviceId, e.target.value)}
                  placeholder="0"
                  min={0}
                  aria-label={`Manual discount for ${item.serviceName}`}
                  data-testid={`discount-input-${item.serviceId}`}
                />
              </div>

              {/* Remove button */}
              <button
                className="cart__remove-btn"
                onClick={() => removeItem(item.serviceId)}
                aria-label={`Remove ${item.serviceName} from cart`}
                data-testid={`remove-${item.serviceId}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Note field */}
      <div className="cart__note">
        <label htmlFor="cart-note" className="cart__note-label">
          Note
        </label>
        <textarea
          id="cart-note"
          className="cart__note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          maxLength={500}
          aria-label="Order note"
          data-testid="cart-note"
        />
      </div>

      {/* Cart Summary */}
      <div className="cart__summary" data-testid="cart-summary">
        <div className="cart__summary-row">
          <span>Subtotal</span>
          <span data-testid="summary-subtotal">Rp {summary.subtotal.toLocaleString()}</span>
        </div>
        {summary.serviceCharge > 0 && (
          <div className="cart__summary-row">
            <span>Service Charge</span>
            <span data-testid="summary-service-charge">
              Rp {summary.serviceCharge.toLocaleString()}
            </span>
          </div>
        )}
        {summary.tax > 0 && (
          <div className="cart__summary-row">
            <span>Tax/PPN</span>
            <span data-testid="summary-tax">Rp {summary.tax.toLocaleString()}</span>
          </div>
        )}
        {summary.voucherDiscount > 0 && (
          <div className="cart__summary-row cart__summary-row--discount">
            <span>Voucher Discount</span>
            <span data-testid="summary-voucher-discount">
              -Rp {summary.voucherDiscount.toLocaleString()}
            </span>
          </div>
        )}
        {summary.promoDiscount > 0 && (
          <div className="cart__summary-row cart__summary-row--discount">
            <span>Promo Discount</span>
            <span data-testid="summary-promo-discount">
              -Rp {summary.promoDiscount.toLocaleString()}
            </span>
          </div>
        )}
        <div className="cart__summary-row cart__summary-row--total">
          <span>Total</span>
          <span data-testid="summary-total">Rp {summary.total.toLocaleString()}</span>
        </div>
      </div>

      {/* Place Order button */}
      <button
        className="cart__place-order-btn"
        onClick={handlePlaceOrder}
        aria-label="Place order"
        data-testid="place-order-btn"
      >
        Place Order
      </button>
    </div>
  );
}
