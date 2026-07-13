'use client';

import { useState, useCallback } from 'react';
import { Check } from 'lucide-react';

/**
 * WhatsApp Integration section. Controlled by the Settings page, which owns the
 * persisted values and the save handler (PATCH /api/settings/:tenantId).
 * Requirements: 2.1, 11.4, 11.5
 */

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

function validatePhone(phone: string): string | null {
  if (!phone) return null; // Empty is not an error until the user tries to save
  if (!E164_PATTERN.test(phone)) {
    return 'Invalid phone number. Use E.164 format (e.g. +14155551234)';
  }
  return null;
}

export interface WhatsAppSectionProps {
  /** Current saved phone number (E.164) or null. */
  phone: string | null;
  /** Whether an API token is already stored (secret is never sent to the client). */
  tokenSet: boolean;
  /**
   * Persist the section. `token` is empty when the user left the (masked) field
   * untouched — the parent then omits it so the stored token is kept.
   */
  onSave: (phone: string, token: string) => Promise<void>;
}

export default function WhatsAppSection({ phone: initialPhone, tokenSet, onSave }: WhatsAppSectionProps) {
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [token, setToken] = useState('');
  const [tokenDirty, setTokenDirty] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPhone(value);
    setSaveSuccess(false);
    setPhoneError(value === '' ? null : validatePhone(value));
  }, []);

  const handleTokenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setToken(e.target.value);
    setTokenDirty(true);
    setSaveSuccess(false);
  }, []);

  const handleSave = useCallback(async () => {
    const error = validatePhone(phone);
    if (error) { setPhoneError(error); return; }
    if (!phone) { setPhoneError('Phone number is required'); return; }

    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      await onSave(phone, tokenDirty ? token : '');
      setSaveSuccess(true);
      setTokenDirty(false);
      setToken('');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [phone, token, tokenDirty, onSave]);

  return (
    <section data-testid="whatsapp-section" className="card space-y-4">
      <div>
        <h2 className="section-title">WhatsApp Integration</h2>
        <p className="section-description">
          Send customer notifications from your business WhatsApp number.
        </p>
      </div>

      <div>
        <label htmlFor="whatsapp-phone" className="block text-sm font-medium text-text-primary mb-1.5">
          Phone Number (E.164)
        </label>
        <input
          id="whatsapp-phone"
          data-testid="whatsapp-phone-input"
          type="tel"
          className="input-field"
          placeholder="+14155551234"
          value={phone}
          onChange={handlePhoneChange}
          aria-invalid={phoneError ? 'true' : undefined}
          aria-describedby={phoneError ? 'whatsapp-phone-error' : undefined}
        />
        {phoneError && (
          <p id="whatsapp-phone-error" data-testid="whatsapp-phone-error" className="mt-1 text-xs text-error" role="alert">
            {phoneError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="whatsapp-token" className="block text-sm font-medium text-text-primary mb-1.5">
          API Token {tokenSet && <span className="text-xs text-text-muted font-normal">· stored</span>}
        </label>
        <input
          id="whatsapp-token"
          data-testid="whatsapp-token-input"
          type="password"
          className="input-field"
          placeholder={tokenSet ? 'Leave blank to keep current token' : 'Enter your WhatsApp API token'}
          value={token}
          onChange={handleTokenChange}
        />
      </div>

      {saveError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{saveError}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          data-testid="whatsapp-save-button"
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || !!phoneError}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveSuccess && (
          <p data-testid="whatsapp-save-success" className="inline-flex items-center gap-1.5 text-sm text-success" role="status">
            <Check size={14} /> WhatsApp credentials saved.
          </p>
        )}
      </div>
    </section>
  );
}
