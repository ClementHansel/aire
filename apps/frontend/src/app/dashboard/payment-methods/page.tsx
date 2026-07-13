'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Branch { id: string; name: string }
interface PaymentMethod {
  id: string; outletId: string | null; name: string; kind: string;
  businessUnit: 'AIRE' | 'LEAD' | null; logoUrl: string | null; color: string; sortOrder: number; isActive: boolean;
}

const KINDS = ['cash', 'qris', 'edc', 'cc', 'transfer'];

interface FormState { name: string; kind: string; businessUnit: '' | 'AIRE' | 'LEAD'; color: string; outletId: string; logoUrl: string; isActive: boolean }
const EMPTY: FormState = { name: '', kind: 'qris', businessUnit: '', color: '#1652F0', outletId: '', logoUrl: '', isActive: true };

const KIND_HELP: Record<string, string> = {
  cash: 'Physical cash in the drawer.',
  qris: 'QR code scan (GoPay, OVO, Dana, bank apps…).',
  edc: 'Card machine / EDC terminal (debit or credit swipe).',
  cc: 'Credit card charged directly.',
  transfer: 'Manual bank transfer.',
};

function MethodModal({ initial, branches, onClose, onSaved }: { initial: PaymentMethod | null; branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(
    initial ? { name: initial.name, kind: initial.kind, businessUnit: initial.businessUnit ?? '', color: initial.color, outletId: initial.outletId ?? '', logoUrl: initial.logoUrl ?? '', isActive: initial.isActive } : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name: form.name, kind: form.kind,
      businessUnit: form.businessUnit || null,
      color: form.color, logoUrl: form.logoUrl || null,
      outletId: form.outletId || null,
      isActive: form.isActive,
    };
    try {
      if (initial) await api.put(`/payment-methods/${initial.id}`, payload);
      else await api.post('/payment-methods', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.paymentMethods.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.paymentMethods.editTitle', 'Edit Payment Method') : t('dash.paymentMethods.addTitle', 'Add Payment Method')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.paymentMethods.nameLabel', 'Name (as shown on the POS button)')}</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('dash.paymentMethods.namePlaceholder', 'e.g. EDC BRI / QRIS BCA')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.paymentMethods.kind', 'Type')}</label>
              <select className="input-field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
              </select>
              <p className="mt-1 text-xs text-text-muted">{t(`dash.paymentMethods.kindHelp.${form.kind}`, KIND_HELP[form.kind] ?? '')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.paymentMethods.settlesTo', 'Settles to')}</label>
              <select className="input-field" value={form.businessUnit} onChange={(e) => setForm({ ...form, businessUnit: e.target.value as FormState['businessUnit'] })}>
                <option value="">{t('dash.paymentMethods.buNone', 'n/a (e.g. cash)')}</option>
                <option value="AIRE">AIRE</option>
                <option value="LEAD">LEAD</option>
              </select>
              <p className="mt-1 text-xs text-text-muted">{t('dash.paymentMethods.settlesToHelp', 'Which business account receives this money. Leave n/a for cash.')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.paymentMethods.color', 'Color')}</label>
              <input type="color" className="input-field h-10 p-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.paymentMethods.branch', 'Branch')}</label>
              <select className="input-field" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
                <option value="">{t('dash.paymentMethods.allBranches', 'All branches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.paymentMethods.logoUrl', 'Logo URL (optional)')}</label>
            <input className="input-field" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/bri.png" />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {t('dash.paymentMethods.active', 'Active (shown on POS)')}
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.paymentMethods.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.paymentMethods.saving', 'Saving…') : initial ? t('dash.paymentMethods.update', 'Update') : t('dash.paymentMethods.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PaymentMethodsPage() {
  const { t } = useI18n();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [m, b] = await Promise.all([api.get<PaymentMethod[]>('/payment-methods'), api.get<Branch[]>('/outlets')]);
      setMethods(m); setBranches(b);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.paymentMethods.loadFailed', 'Failed to load')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [seeding, setSeeding] = useState(false);

  const remove = async (id: string) => {
    if (!confirm(t('dash.paymentMethods.confirmDelete', 'Delete this payment method?'))) return;
    try { await api.delete(`/payment-methods/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.paymentMethods.deleteFailed', 'Delete failed')); }
  };

  const seedDefaults = async () => {
    setSeeding(true); setError('');
    try { await api.post('/payment-methods/seed-defaults', {}); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.paymentMethods.seedFailed', 'Could not add defaults')); }
    finally { setSeeding(false); }
  };

  const branchName = (id: string | null) => id ? (branches.find((b) => b.id === id)?.name ?? '—') : t('dash.paymentMethods.allBranches', 'All branches');

  return (
    <div data-testid="payment-methods-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.paymentMethods.title', 'Payment Methods')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.paymentMethods.subtitle', 'Configure per-branch payment buttons (with colour + logo) shown on the POS.')}</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>{t('dash.paymentMethods.addBtn', '+ Add Method')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {!loading && methods.length > 0 && !methods.some((m) => m.isActive) && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 mb-4">
          {t('dash.paymentMethods.noneActiveWarn', 'No payment method is active — the POS will have no payment buttons. Activate at least one.')}
        </div>
      )}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.paymentMethods.loading', 'Loading…')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {methods.length === 0 ? (
            <div className="card col-span-full">
              <p className="text-sm font-medium text-text-primary">{t('dash.paymentMethods.empty', 'No payment methods yet.')}</p>
              <p className="text-xs text-text-muted mt-1">{t('dash.paymentMethods.emptyHint', 'Cashiers need at least one to record how a customer paid. Start with the common set below, then edit or add your own.')}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  { label: 'Cash', color: '#16a34a' },
                  { label: 'QRIS', color: '#4f46e5' },
                  { label: 'Debit / Credit (EDC)', color: '#ea580c' },
                  { label: 'Bank Transfer', color: '#475569' },
                ].map((d) => (
                  <span key={d.label} className="inline-flex items-center gap-1.5 text-xs text-text-secondary border border-border rounded-full px-2.5 py-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />{d.label}
                  </span>
                ))}
              </div>
              <button className="btn-primary mt-4" onClick={seedDefaults} disabled={seeding}>
                {seeding ? t('dash.paymentMethods.seeding', 'Adding…') : t('dash.paymentMethods.seedBtn', 'Add these default methods')}
              </button>
            </div>
          ) : methods.map((m) => (
            <div key={m.id} className={`card flex items-center gap-3 ${m.isActive ? '' : 'opacity-60'}`}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: m.color }}>
                {m.logoUrl ? <img src={m.logoUrl} alt="" className="w-7 h-7 object-contain" /> : m.kind.toUpperCase().slice(0, 3)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary text-sm truncate flex items-center gap-1.5">
                  {m.name}
                  {!m.isActive && <span className="badge bg-gray-100 text-gray-500 text-[10px]">{t('dash.paymentMethods.hidden', 'Hidden')}</span>}
                </p>
                <p className="text-xs text-text-muted">{m.kind.toUpperCase()}{m.businessUnit ? ` · ${m.businessUnit}` : ''} · {branchName(m.outletId)}</p>
              </div>
              <div className="flex flex-col gap-1">
                <button className="btn-ghost text-xs py-1" onClick={() => { setEditing(m); setModalOpen(true); }}>{t('dash.paymentMethods.edit', 'Edit')}</button>
                <button className="btn-ghost text-xs py-1 text-red-600" onClick={() => remove(m.id)}>{t('dash.paymentMethods.delete', 'Delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && <MethodModal initial={editing} branches={branches} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
