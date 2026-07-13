'use client';

/**
 * Platform subscription plans — what the PLATFORM charges each tenant. Distinct
 * from a tenant's own Membership plans (/dashboard/memberships), which they sell
 * to their customers. A tenant is put on a plan via its `plan` code (Tenants →
 * Edit). Prices here drive the Billing page's MRR. Super-admin only.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Modal, Field, ErrorBanner, fmtIDR } from '@/components/dashboard/ui';

type BillingCycle = 'monthly' | 'annual';
interface PlatformPlan {
  id: string; code: string; name: string; description: string | null;
  price: number; billingCycle: BillingCycle; features: string[];
  limits: Record<string, number>; isActive: boolean; sortOrder: number;
}

interface FormState {
  code: string; name: string; description: string; price: string;
  billingCycle: BillingCycle; features: string[]; limits: { key: string; value: string }[];
  isActive: boolean; sortOrder: string;
}
const EMPTY: FormState = {
  code: '', name: '', description: '', price: '', billingCycle: 'monthly',
  features: [], limits: [], isActive: true, sortOrder: '0',
};

function PlanModal({ initial, onClose, onSaved }: { initial: PlatformPlan | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          code: initial.code, name: initial.name, description: initial.description ?? '',
          price: String(initial.price), billingCycle: initial.billingCycle,
          features: initial.features ?? [],
          limits: Object.entries(initial.limits ?? {}).map(([key, value]) => ({ key, value: String(value) })),
          isActive: initial.isActive, sortOrder: String(initial.sortOrder),
        }
      : EMPTY,
  );
  const [featureDraft, setFeatureDraft] = useState('');
  const [limitDraft, setLimitDraft] = useState({ key: '', value: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addFeature = () => {
    const f = featureDraft.trim();
    if (!f) return;
    setForm((s) => ({ ...s, features: [...s.features, f] }));
    setFeatureDraft('');
  };
  const removeFeature = (i: number) => setForm((s) => ({ ...s, features: s.features.filter((_, idx) => idx !== i) }));
  const addLimit = () => {
    const key = limitDraft.key.trim();
    const value = Number(limitDraft.value);
    if (!key || !Number.isFinite(value)) return;
    setForm((s) => ({ ...s, limits: [...s.limits.filter((l) => l.key !== key), { key, value: String(value) }] }));
    setLimitDraft({ key: '', value: '' });
  };
  const removeLimit = (key: string) => setForm((s) => ({ ...s, limits: s.limits.filter((l) => l.key !== key) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Number(form.price) || 0,
      billingCycle: form.billingCycle,
      features: form.features,
      limits: Object.fromEntries(form.limits.map((l) => [l.key, Number(l.value) || 0])),
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
    };
    try {
      if (initial) await api.put(`/admin/platform-plans/${initial.id}`, payload);
      else await api.post('/admin/platform-plans', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={initial ? 'Edit plan' : 'New plan'}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="plan-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Create'}</button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" hint="Matches a tenant's plan."><input className="input-field font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="standard" /></Field>
          <Field label="Name"><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Standard" /></Field>
        </div>
        <Field label="Description"><input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="For single-branch operators" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="Price (Rp)"><input className="input-field" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></Field></div>
          <Field label="Cycle">
            <select className="input-field" value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value as BillingCycle })}>
              <option value="monthly">Monthly</option><option value="annual">Annual</option>
            </select>
          </Field>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-primary">Features</label>
          {form.features.length > 0 && (
            <div className="space-y-1 mb-2">
              {form.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm rounded-lg border border-border px-2 py-1">
                  <span className="flex-1">{f}</span>
                  <button type="button" className="btn-ghost text-xs text-rose-600" onClick={() => removeFeature(i)}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input className="input-field flex-1" value={featureDraft} onChange={(e) => setFeatureDraft(e.target.value)} placeholder="e.g. Unlimited branches" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFeature(); } }} />
            <button type="button" className="btn-secondary text-xs" onClick={addFeature}>Add</button>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-primary">Limits</label>
          {form.limits.length > 0 && (
            <div className="space-y-1 mb-2">
              {form.limits.map((l) => (
                <div key={l.key} className="flex items-center gap-2 text-sm rounded-lg border border-border px-2 py-1">
                  <span className="flex-1 font-mono">{l.key}</span>
                  <span className="badge bg-surface-sunken text-text-secondary text-xs">{l.value}</span>
                  <button type="button" className="btn-ghost text-xs text-rose-600" onClick={() => removeLimit(l.key)}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input className="input-field flex-1" value={limitDraft.key} onChange={(e) => setLimitDraft((d) => ({ ...d, key: e.target.value }))} placeholder="outlets" />
            <input className="input-field w-24" type="number" value={limitDraft.value} onChange={(e) => setLimitDraft((d) => ({ ...d, value: e.target.value }))} placeholder="5" />
            <button type="button" className="btn-secondary text-xs" onClick={addLimit}>Add</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 items-center">
          <Field label="Sort order"><input className="input-field" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm mt-6">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
          </label>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; editing: PlatformPlan | null }>({ open: false, editing: null });
  const [deactivating, setDeactivating] = useState<PlatformPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setPlans(await api.get<PlatformPlan[]>('/admin/platform-plans')); }
    catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load plans';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (getUser()?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    load();
  }, [load]);

  const deactivate = async () => {
    if (!deactivating) return;
    try { await api.delete(`/admin/platform-plans/${deactivating.id}`); setDeactivating(null); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); setDeactivating(null); }
  };

  if (forbidden) return (
    <div className="max-w-md">
      <h1 className="text-xl font-bold text-text-primary mb-2">Access Denied</h1>
      <p className="text-sm text-text-secondary">This area requires a Platform Super Admin account.</p>
      <button onClick={logout} className="btn-secondary mt-4">Sign in as different user</button>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="admin-plans">
      <PageHeader
        title="Subscription Plans"
        subtitle="The plans the platform charges each tenant. Separate from a tenant's own membership plans. Assign a tenant to a plan under Tenants → Edit; prices here drive Billing."
        actions={<button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ New plan</button>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {loading ? (
        <Panel><p className="text-sm text-text-muted">Loading…</p></Panel>
      ) : plans.length === 0 ? (
        <Panel><p className="text-sm text-text-muted">No plans yet. Click “New plan”.</p></Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className={cn('card relative', !p.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">{p.name}</h3>
                  <p className="text-xs text-text-muted font-mono">{p.code}</p>
                </div>
                {!p.isActive && <span className="badge bg-surface-sunken text-text-secondary text-xs">Inactive</span>}
              </div>
              <p className="text-2xl font-bold text-primary-600 mt-2">{fmtIDR(p.price)}<span className="text-sm font-normal text-text-muted">/{p.billingCycle === 'annual' ? 'yr' : 'mo'}</span></p>
              {p.description && <p className="text-sm text-text-muted mt-1">{p.description}</p>}
              {p.features.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-border space-y-1">
                  {p.features.map((f, i) => <li key={i} className="text-sm flex gap-2"><span className="text-green-600">✓</span>{f}</li>)}
                </ul>
              )}
              {Object.keys(p.limits).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-1">
                  {Object.entries(p.limits).map(([k, v]) => <span key={k} className="badge bg-surface-sunken text-text-secondary text-xs">{k}: {v}</span>)}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-border flex gap-2">
                <button className="btn-secondary flex-1 text-xs" onClick={() => setModal({ open: true, editing: p })}>Edit</button>
                {p.isActive && <button className="btn-ghost text-xs text-rose-600" onClick={() => setDeactivating(p)}>Deactivate</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && <PlanModal initial={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}

      {deactivating && (
        <Modal
          title="Deactivate plan"
          onClose={() => setDeactivating(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setDeactivating(null)}>Cancel</button>
              <button className="btn-primary" onClick={deactivate}>Deactivate</button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">Deactivate the “{deactivating.name}” plan? Tenants already on it keep their assignment; it just won&apos;t be offered.</p>
        </Modal>
      )}
    </div>
  );
}
