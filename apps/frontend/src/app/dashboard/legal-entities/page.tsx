'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface LegalEntity {
  id: string;
  name: string;
  npwp: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

interface FormState { name: string; npwp: string; address: string; phone: string }
const EMPTY: FormState = { name: '', npwp: '', address: '', phone: '' };

function LegalEntityModal({ initial, onClose, onSaved }: { initial: LegalEntity | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(
    initial
      ? { name: initial.name, npwp: initial.npwp ?? '', address: initial.address ?? '', phone: initial.phone ?? '' }
      : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name: form.name,
      npwp: form.npwp || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
    };
    try {
      if (initial) await api.put(`/legal-entities/${initial.id}`, payload);
      else await api.post('/legal-entities', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.legalEntities.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.legalEntities.editTitle', 'Edit Legal Entity') : t('dash.legalEntities.addTitle', 'Add Legal Entity')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.legalEntities.name', 'Legal entity name (PT)')}</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="PT Aire Bersih Nusantara" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.legalEntities.npwp', 'NPWP (tax ID)')}</label>
            <input className="input-field" value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} placeholder="01.234.567.8-901.000" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.legalEntities.address', 'Registered address')}</label>
            <input className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jl. ..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.legalEntities.phone', 'Phone')}</label>
            <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="021-..." />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.legalEntities.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.legalEntities.saving', 'Saving…') : initial ? t('dash.legalEntities.update', 'Update') : t('dash.legalEntities.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LegalEntitiesPage() {
  const { t } = useI18n();
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LegalEntity | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setEntities(await api.get<LegalEntity[]>('/legal-entities')); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.legalEntities.loadFailed', 'Failed to load legal entities')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (le: LegalEntity) => {
    if (!confirm(t('dash.legalEntities.confirmDelete', 'Delete this legal entity? Branches assigned to it will become unassigned.'))) return;
    try { await api.delete(`/legal-entities/${le.id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.legalEntities.actionFailed', 'Action failed')); }
  };

  return (
    <div data-testid="legal-entities-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.legalEntities.title', 'Legal Entities (PT)')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.legalEntities.subtitle', 'The legal entities (PT) your tenant operates under. Assign each branch to one of these.')}</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>{t('dash.legalEntities.addBtn', '+ Add Legal Entity')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.legalEntities.loading', 'Loading…')}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.legalEntities.colName', 'Legal Entity')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.legalEntities.colNpwp', 'NPWP')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.legalEntities.colContact', 'Contact')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.legalEntities.colActions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entities.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.legalEntities.empty', 'No legal entities yet. Add the PT your branches operate under.')}</td></tr>
              ) : entities.map((le) => (
                <tr key={le.id}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{le.name}<div className="text-xs text-text-muted">{le.address}</div></td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary font-mono">{le.npwp ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">{le.phone ?? '—'}</td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => { setEditing(le); setModalOpen(true); }}>{t('dash.legalEntities.edit', 'Edit')}</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => remove(le)}>{t('dash.legalEntities.delete', 'Delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && <LegalEntityModal initial={editing} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
