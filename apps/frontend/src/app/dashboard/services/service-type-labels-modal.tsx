'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  DEFAULT_SERVICE_TYPE_LABELS,
  type ServiceTypeCode,
  type ServiceTypeLabel,
} from '@/lib/useServiceTypeLabels';

/**
 * Rename the three service types (AIRIN-175).
 *
 * What this deliberately does NOT offer is "add a type". The codes are fixed:
 * the POS refuses a cart with no `car_wash` line, and the Products page is the
 * `product` code. A fourth type would be a line item nothing downstream knows
 * how to price, group or validate — so the tenant owns the wording, not the set.
 *
 * Clearing a field restores the built-in name; the backend deletes the override
 * rather than storing the default back.
 */
export function ServiceTypeLabelsModal({
  types,
  onClose,
  onSaved,
}: {
  types: ServiceTypeLabel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(types.map((x) => [x.code, x.customized ? x.label : ''])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.put('/service-types', draft);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.services.typeLabelsSaveFailed', 'Failed to save names'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()} data-testid="service-type-labels-modal">
        <h3 className="section-title mb-1">{t('dash.services.renameTypesTitle', 'Rename service types')}</h3>
        <p className="text-sm text-text-secondary mb-4">
          {t('dash.services.renameTypesHelp', 'Change what these are called throughout the dashboard and POS. Leave a field empty to use the built-in name.')}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          {types.map((x) => (
            <div key={x.code}>
              <label className="block text-sm font-medium text-text-primary mb-1.5" htmlFor={`stl-${x.code}`}>
                {t(`dash.services.typeName.${x.code}`, DEFAULT_SERVICE_TYPE_LABELS[x.code as ServiceTypeCode] ?? x.code)}
              </label>
              <input
                id={`stl-${x.code}`}
                className="input-field"
                maxLength={60}
                value={draft[x.code] ?? ''}
                placeholder={DEFAULT_SERVICE_TYPE_LABELS[x.code as ServiceTypeCode] ?? x.code}
                onChange={(e) => setDraft({ ...draft, [x.code]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.services.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('dash.services.saving', 'Saving…') : t('dash.services.save', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
