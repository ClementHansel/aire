/**
 * POS New Order page.
 * Combines MenuGrid and Cart components for the order creation flow.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.7, 6.8, 6.9, 6.10
 */
'use client';

import React, { useState, useCallback } from 'react';
import { MenuGrid, ServiceTile } from '@/components/pos/MenuGrid';
import { Cart } from '@/components/pos/Cart';
import { ValidationError } from '@aire/shared/validators';

// TODO: Replace with real data fetching (API call to GET /api/services)
const MOCK_SERVICES: ServiceTile[] = [];

export default function NewOrderPage() {
  const [customerName] = useState('');
  const [customerPhone] = useState('');
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [services] = useState<ServiceTile[]>(MOCK_SERVICES);

  const handlePlaceOrder = useCallback(() => {
    // TODO: Navigate to payment window after validation passes
    // This will be implemented in task 37.5
  }, []);

  const handleValidationErrors = useCallback((errors: ValidationError[]) => {
    setValidationErrors(errors);
  }, []);

  return (
    <div className="new-order-page" data-testid="new-order-page">
      <div className="new-order-page__header">
        <h1>New Order</h1>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div
          className="new-order-page__errors"
          role="alert"
          aria-live="assertive"
          data-testid="validation-errors"
        >
          {validationErrors.map((error) => (
            <p key={error.code} className="new-order-page__error">
              {error.message}
            </p>
          ))}
        </div>
      )}

      <div className="new-order-page__content">
        {/* Menu Grid - Left panel */}
        <div className="new-order-page__menu">
          <MenuGrid services={services} />
        </div>

        {/* Cart - Right panel */}
        <div className="new-order-page__cart">
          <Cart
            customerName={customerName}
            customerPhone={customerPhone}
            onPlaceOrder={handlePlaceOrder}
            onValidationErrors={handleValidationErrors}
          />
        </div>
      </div>
    </div>
  );
}
