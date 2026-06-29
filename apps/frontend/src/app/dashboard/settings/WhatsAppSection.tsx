'use client';

import { useState, useCallback } from 'react';

/**
 * WhatsApp Integration section for tenant settings.
 * Provides phone number input with E.164 validation and masked API token input.
 * Requirements: 2.1, 11.4, 11.5
 */

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

function validatePhone(phone: string): string | null {
  if (!phone) return null; // Empty is not an error (field is optional until save)
  if (!E164_PATTERN.test(phone)) {
    return 'Invalid phone number. Use E.164 format (e.g. +14155551234)';
  }
  return null;
}

export default function WhatsAppSection() {
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPhone(value);
    setSaveSuccess(false);

    // Real-time validation feedback
    if (value === '') {
      setPhoneError(null);
    } else {
      setPhoneError(validatePhone(value));
    }
  }, []);

  const handleTokenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setToken(e.target.value);
    setSaveSuccess(false);
  }, []);

  const handleSave = useCallback(async () => {
    // Validate before save
    const error = validatePhone(phone);
    if (error) {
      setPhoneError(error);
      return;
    }

    if (!phone) {
      setPhoneError('Phone number is required');
      return;
    }

    setSaving(true);
    setSaveSuccess(false);

    try {
      const tenantId = 'current'; // Resolved by backend from auth context
      const response = await fetch(`/api/settings/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsapp_phone: phone,
          whatsapp_token: token || undefined,
        }),
      });

      if (response.ok) {
        setSaveSuccess(true);
      }
    } catch {
      // Network error — silently handled, could be extended with error state
    } finally {
      setSaving(false);
    }
  }, [phone, token]);

  return (
    <section data-testid="whatsapp-section" className="settings-section">
      <h2 className="settings-section-title">WhatsApp Integration</h2>
      <p className="settings-section-description">
        Configure your WhatsApp Business credentials for customer notifications.
      </p>

      <div className="settings-field">
        <label htmlFor="whatsapp-phone">Phone Number (E.164)</label>
        <input
          id="whatsapp-phone"
          data-testid="whatsapp-phone-input"
          type="tel"
          placeholder="+14155551234"
          value={phone}
          onChange={handlePhoneChange}
          aria-invalid={phoneError ? 'true' : undefined}
          aria-describedby={phoneError ? 'whatsapp-phone-error' : undefined}
        />
        {phoneError && (
          <p
            id="whatsapp-phone-error"
            data-testid="whatsapp-phone-error"
            className="field-error"
            role="alert"
          >
            {phoneError}
          </p>
        )}
      </div>

      <div className="settings-field">
        <label htmlFor="whatsapp-token">API Token</label>
        <input
          id="whatsapp-token"
          data-testid="whatsapp-token-input"
          type="password"
          placeholder="Enter your WhatsApp API token"
          value={token}
          onChange={handleTokenChange}
        />
      </div>

      <button
        data-testid="whatsapp-save-button"
        className="btn-primary"
        onClick={handleSave}
        disabled={saving || !!phoneError}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>

      {saveSuccess && (
        <p data-testid="whatsapp-save-success" className="save-success" role="status">
          WhatsApp credentials saved successfully.
        </p>
      )}
    </section>
  );
}
