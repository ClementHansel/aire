'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface OutletSettings {
  service_charge_pct?: number;
  tax_pct?: number;
  free_void_window_minutes?: number;
  /** Owner cap on the cashier's per-line manual discount, 0-1 fraction (e.g. 0.3 = 30%). */
  max_manual_discount_pct?: number;
  [key: string]: unknown;
}

interface Branch {
  id: string;
  name: string;
  code: string | null;
  legalEntity: string | null;
  legalEntityId: string | null;
  address: string | null;
  phone: string | null;
  mapsUrl: string | null;
  isActive: boolean;
  settings?: OutletSettings;
}

interface LegalEntity { id: string; name: string; isActive: boolean }

interface FormState { name: string; code: string; legalEntityId: string; address: string; phone: string; mapsUrl: string; maxManualDiscountPct: string }
const EMPTY: FormState = { name: '', code: '', legalEntityId: '', address: '', phone: '', mapsUrl: '', maxManualDiscountPct: '30' };

function BranchModal({ initial, legalEntities, onClose, onSaved }: { initial: Branch | null; legalEntities: LegalEntity[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name, code: initial.code ?? '', legalEntityId: initial.legalEntityId ?? '',
          address: initial.address ?? '', phone: initial.phone ?? '', mapsUrl: initial.mapsUrl ?? '',
          maxManualDiscountPct: String(Math.round((initial.settings?.max_manual_discount_pct ?? 0.3) * 100)),
        }
      : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const pct = Number(form.maxManualDiscountPct);
    const clampedPct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 30;
    const payload = {
      name: form.name,
      code: form.code || undefined,
      // null clears the assignment; undefined would leave it unchanged.
      legalEntityId: form.legalEntityId || null,
      address: form.address || undefined,
      phone: form.phone || undefined,
      mapsUrl: form.mapsUrl || undefined,
      // `settings` is replaced wholesale server-side, so merge onto the existing
      // object rather than sending only the field this form edits.
      settings: {
        ...(initial?.settings ?? {}),
        max_manual_discount_pct: clampedPct / 100,
      },
    };
    try {
      if (initial) await api.put(`/outlets/${initial.id}`, payload);
      else await api.post('/outlets', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.branches.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.branches.editTitle', 'Edit Branch') : t('dash.branches.addTitle', 'Add Branch')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.branchName', 'Branch name')}</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('dash.branches.branchNamePlaceholder', 'e.g. Outlet Bintaro')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.branchCode', 'Branch code (3 letters — used in voucher codes)')}</label>
            <input className="input-field uppercase" maxLength={8} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="BTR" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.legalEntityLabel', 'Legal entity (PT)')}</label>
            {legalEntities.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t('dash.branches.noLegalEntities', 'No legal entities yet.')}{' '}
                <Link href="/dashboard/legal-entities" className="text-primary-600 hover:text-primary-700">{t('dash.branches.manageLegalEntities', 'Add one')}</Link>
              </p>
            ) : (
              <>
                <select className="input-field" value={form.legalEntityId} onChange={(e) => setForm({ ...form, legalEntityId: e.target.value })}>
                  <option value="">{t('dash.branches.legalEntityNone', '— None —')}</option>
                  {legalEntities.map((le) => (
                    <option key={le.id} value={le.id}>{le.name}</option>
                  ))}
                </select>
                <Link href="/dashboard/legal-entities" className="mt-1 inline-block text-xs text-primary-600 hover:text-primary-700">{t('dash.branches.manageLegalEntities', 'Manage legal entities')}</Link>
              </>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.address', 'Address')}</label>
            <input className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jl. ..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.phone', 'Phone (WhatsApp)')}</label>
              <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08118005650" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.mapsLink', 'Google Maps link')}</label>
              <input className="input-field" value={form.mapsUrl} onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.branches.maxManualDiscount', 'Max manual discount at the register (%)')}</label>
            <input
              aria-label={t('dash.branches.maxManualDiscount', 'Max manual discount at the register (%)')}
              type="number" min="0" max="100" step="1"
              className="input-field w-32"
              value={form.maxManualDiscountPct}
              onChange={(e) => setForm({ ...form, maxManualDiscountPct: e.target.value })}
            />
            <p className="text-xs text-text-muted mt-1">{t('dash.branches.maxManualDiscountHint', 'Caps the per-line discount a cashier can apply manually at checkout. Enforced by the server; default is 30%.')}</p>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.branches.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.branches.saving', 'Saving…') : initial ? t('dash.branches.update', 'Update') : t('dash.branches.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BranchesPage() {
  const { t } = useI18n();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [outlets, entities] = await Promise.all([
        api.get<Branch[]>('/outlets'),
        api.get<LegalEntity[]>('/legal-entities'),
      ]);
      setBranches(outlets);
      setLegalEntities(entities);
    }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.branches.loadFailed', 'Failed to load branches')); }
    finally { setLoading(false); }
  }, []);

  const entityName = (id: string | null) => legalEntities.find((le) => le.id === id)?.name ?? null;

  useEffect(() => { load(); }, [load]);

  const toggle = async (b: Branch) => {
    try { await api.patch(`/outlets/${b.id}/${b.isActive ? 'deactivate' : 'activate'}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.branches.actionFailed', 'Action failed')); }
  };

  return (
    <div data-testid="branches-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.branches.title', 'Branches')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.branches.subtitle', 'Manage your outlets — name, branch code, legal entity (PT), and address.')}</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>{t('dash.branches.addBtn', '+ Add Branch')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.branches.loading', 'Loading…')}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.branches.colBranch', 'Branch')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.branches.colCode', 'Code')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.branches.colLegalEntity', 'Legal Entity (PT)')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.branches.colContact', 'Contact')}</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.branches.colStatus', 'Status')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.branches.colActions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {branches.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.branches.empty', 'No branches yet.')}</td></tr>
              ) : branches.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{b.name}<div className="text-xs text-text-muted">{b.address}</div></td>
                  <td className="px-5 py-3.5"><span className="badge bg-sky-50 text-sky-700 font-mono">{b.code ?? '—'}</span></td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">{entityName(b.legalEntityId) ?? b.legalEntity ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">
                    {b.phone ?? '—'}
                    {b.mapsUrl && (
                      <a href={b.mapsUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary-600 hover:text-primary-700">📍 {t('dash.branches.maps', 'Maps')}</a>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-center"><span className={`badge ${b.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{b.isActive ? t('dash.branches.active', 'Active') : t('dash.branches.inactive', 'Inactive')}</span></td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => { setEditing(b); setModalOpen(true); }}>{t('dash.branches.edit', 'Edit')}</button>
                    <button className="btn-ghost text-xs text-amber-600" onClick={() => toggle(b)}>{b.isActive ? t('dash.branches.deactivate', 'Deactivate') : t('dash.branches.activate', 'Activate')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && <BranchModal initial={editing} legalEntities={legalEntities} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
