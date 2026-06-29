/**
 * CustomerForm component for POS new order flow.
 * Provides customer information fields and a "Check" button for member lookup.
 *
 * Requirements: 6.4, 6.5, 6.6
 */
'use client';

import React, { useCallback } from 'react';
import { MemberLookupResponse, MembershipDetail } from '@aire/shared/interfaces/member';
import { MemberBanner } from './MemberBanner';
import { useMemberLookup } from '@/hooks/useMemberLookup';

export interface CustomerFormData {
  name: string;
  phone: string;
  licensePlate: string;
  brand: string;
  model: string;
}

export interface CustomerFormProps {
  /** Current form values */
  values: CustomerFormData;
  /** Callback when form values change */
  onChange: (values: CustomerFormData) => void;
  /** Callback when a member lookup succeeds and data should be applied */
  onMemberFound?: (data: MemberLookupResponse) => void;
  /** Service names map for displaying benefit names in the banner */
  serviceNames?: Record<string, string>;
  /** Optional: externally provided member data (e.g., from parent state) */
  memberData?: MemberLookupResponse | null;
  /** Base URL for API calls */
  apiBaseUrl?: string;
}

/**
 * Customer information form with member lookup functionality.
 * - Name (required), Phone (required), License Plate (recommended), Brand (optional), Model (optional)
 * - "Check" button performs member lookup by phone or plate
 * - Auto-fills fields when a member is found
 * - Displays membership banner with plan details
 */
export function CustomerForm({
  values,
  onChange,
  onMemberFound,
  serviceNames = {},
  memberData: externalMemberData,
  apiBaseUrl,
}: CustomerFormProps) {
  const { data: lookupData, loading, error, lookup, clear } = useMemberLookup({
    baseUrl: apiBaseUrl,
  });

  // Use external member data if provided, otherwise use internal lookup data
  const memberData = externalMemberData ?? lookupData;

  const handleFieldChange = useCallback(
    (field: keyof CustomerFormData, value: string) => {
      onChange({ ...values, [field]: value });
    },
    [values, onChange],
  );

  const handleCheck = useCallback(async () => {
    const result = await lookup(values.phone, values.licensePlate);

    if (result) {
      // Auto-fill customer fields from the lookup result
      const customer = result.customer;
      const firstPlate = customer.plates[0];

      const updatedValues: CustomerFormData = {
        name: customer.name || values.name,
        phone: customer.phone || values.phone,
        licensePlate: firstPlate?.plate || values.licensePlate,
        brand: firstPlate?.brand || values.brand,
        model: firstPlate?.model || values.model,
      };

      onChange(updatedValues);
      onMemberFound?.(result);
    }
  }, [values, lookup, onChange, onMemberFound]);

  const handleClear = useCallback(() => {
    clear();
  }, [clear]);

  const activeMemberships: MembershipDetail[] = memberData?.memberships ?? [];

  return (
    <div className="customer-form" data-testid="customer-form">
      {/* Name field (required) */}
      <div className="customer-form__field">
        <label
          htmlFor="customer-name"
          className="customer-form__label customer-form__label--required"
        >
          Name
        </label>
        <input
          id="customer-name"
          type="text"
          className="customer-form__input"
          value={values.name}
          onChange={(e) => handleFieldChange('name', e.target.value)}
          placeholder="Customer name"
          required
          aria-required="true"
          data-testid="input-name"
        />
      </div>

      {/* Phone field (required) */}
      <div className="customer-form__field">
        <label
          htmlFor="customer-phone"
          className="customer-form__label customer-form__label--required"
        >
          Phone
        </label>
        <input
          id="customer-phone"
          type="tel"
          className="customer-form__input"
          value={values.phone}
          onChange={(e) => handleFieldChange('phone', e.target.value)}
          placeholder="08xxxxxxxxxx"
          required
          aria-required="true"
          data-testid="input-phone"
        />
      </div>

      {/* License Plate field (recommended) */}
      <div className="customer-form__field">
        <label htmlFor="customer-plate" className="customer-form__label">
          License Plate
        </label>
        <input
          id="customer-plate"
          type="text"
          className="customer-form__input"
          value={values.licensePlate}
          onChange={(e) => handleFieldChange('licensePlate', e.target.value)}
          placeholder="B 1234 XYZ"
          data-testid="input-plate"
        />
      </div>

      {/* Brand field (optional) */}
      <div className="customer-form__field">
        <label htmlFor="customer-brand" className="customer-form__label">
          Brand
        </label>
        <input
          id="customer-brand"
          type="text"
          className="customer-form__input"
          value={values.brand}
          onChange={(e) => handleFieldChange('brand', e.target.value)}
          placeholder="Toyota"
          data-testid="input-brand"
        />
      </div>

      {/* Model field (optional) */}
      <div className="customer-form__field">
        <label htmlFor="customer-model" className="customer-form__label">
          Model
        </label>
        <input
          id="customer-model"
          type="text"
          className="customer-form__input"
          value={values.model}
          onChange={(e) => handleFieldChange('model', e.target.value)}
          placeholder="Avanza"
          data-testid="input-model"
        />
      </div>

      {/* Check button + Clear */}
      <div className="customer-form__actions">
        <button
          type="button"
          className="customer-form__check-btn"
          onClick={handleCheck}
          disabled={loading || (!values.phone.trim() && !values.licensePlate.trim())}
          aria-label="Check member status"
          data-testid="btn-check"
        >
          {loading ? 'Checking...' : 'Check'}
        </button>

        {memberData && (
          <button
            type="button"
            className="customer-form__clear-btn"
            onClick={handleClear}
            aria-label="Clear member lookup"
            data-testid="btn-clear-lookup"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          className="customer-form__error"
          role="alert"
          data-testid="lookup-error"
        >
          {error}
        </div>
      )}

      {/* Member Banner */}
      {activeMemberships.length > 0 && (
        <MemberBanner
          memberships={activeMemberships}
          serviceNames={serviceNames}
        />
      )}
    </div>
  );
}
