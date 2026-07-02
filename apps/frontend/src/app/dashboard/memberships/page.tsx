'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface MembershipPlan {
  id: string;
  tenantId: string;
  name: string;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  price: number;
  outletIds: string[] | null;
  freeServiceIds: string[] | null;
  isActive: boolean;
}

interface ServiceOption { id: string; name: string; price: number; category: string; businessUnit?: string }
interface OutletOption { id: string; name: string }

interface FormState {
  name: string;
  durationMonths: string;
  maxUses: string;
  dailyLimit: string;
  maxPlates: string;
  price: string;
  freeServiceIds: string[];
  outletIds: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  durationMonths: '1',
  maxUses: '31',
  dailyLimit: '1',
  maxPlates: '3',
  price: '',
  freeServiceIds: [],
  outletIds: [],
};

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function PlanModal({
  initial,
  services,
  outlets,
  onClose,
  onSaved,
}: {
  initial: MembershipPlan | null;
  services: ServiceOption[];
  outlets: OutletOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          durationMonths: String(initial.durationMonths),
          maxUses: String(initial.maxUses),
          dailyLimit: String(initial.dailyLimit),
          maxPlates: String(initial.maxPlates),
          price: String(initial.price),
          freeServiceIds: initial.freeServiceIds ?? [],
          outletIds: initial.outletIds ?? [],
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (key: 'freeServiceIds' | 'outletIds', id: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name: form.name,
      durationMonths: Number(form.durationMonths),
      maxUses: Number(form.maxUses),
      dailyLimit: Number(form.dailyLimit),
      maxPlates: Number(form.maxPlates),
      price: Number(form.price),
      freeServiceIds: form.freeServiceIds,
      // Empty selection = available to all branches.
      outletIds: form.outletIds.length > 0 ? form.outletIds : null,
    };
    try {
      if (initial) {
        await api.put(`/membership-plans/${initial.id}`, payload);
      } else {
        await api.post('/membership-plans', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const washServices = services.filter((s) => s.category === 'car_wash');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Plan' : 'Create Plan'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Plan Name</label>
            <input aria-label="Name" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Duration</label>
            <select aria-label="Duration Months" className="input-field" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}>
              <option value="1">1 month</option>
              <option value="3">3 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Max Uses</label>
              <input aria-label="Max Uses" type="number" min="1" className="input-field" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Daily</label>
              <input aria-label="Daily Limit" type="number" min="1" className="input-field" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Plates</label>
              <input aria-label="Max Plates" type="number" min="1" className="input-field" value={form.maxPlates} onChange={(e) => setForm({ ...form, maxPlates: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Price (Rp)</label>
            <input aria-label="Price" type="number" min="0" className="input-field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Included free washes</label>
            <p className="text-xs text-text-muted mb-2">Services the member gets free, subject to the daily limit.</p>
            <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
              {washServices.length === 0 ? (
                <p className="text-xs text-text-muted">No car wash services found.</p>
              ) : washServices.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                  <input type="checkbox" checked={form.freeServiceIds.includes(s.id)} onChange={() => toggle('freeServiceIds', s.id)} />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-xs text-text-muted">{fmt(s.price)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Available at branches</label>
            <p className="text-xs text-text-muted mb-2">Leave all unchecked = available at every branch.</p>
            <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
              {outlets.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                  <input type="checkbox" checked={form.outletIds.includes(o.id)} onChange={() => toggle('outletIds', o.id)} />
                  <span>{o.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MembershipsPage() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MembershipPlan | null>(null);
  const [branch, setBranch] = useState('');

  // Config filter: a plan with no outletIds (or empty) is available at every branch.
  const visiblePlans = plans.filter(
    (p) => !branch || !p.outletIds || p.outletIds.length === 0 || p.outletIds.includes(branch),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [plansData, servicesData, outletsData] = await Promise.all([
        api.get<MembershipPlan[]>('/membership-plans'),
        api.get<ServiceOption[]>('/services?businessUnit=AIRE'),
        api.get<OutletOption[]>('/outlets'),
      ]);
      setPlans(plansData);
      setServices(servicesData);
      setOutlets(outletsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';
  const outletName = (id: string) => outlets.find((o) => o.id === id)?.name ?? '—';

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this plan?')) return;
    try {
      await api.delete(`/membership-plans/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div data-testid="memberships-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="memberships-title">Membership Plans</h1>
          <p className="mt-1 text-sm text-text-secondary">Configure plans, quotas, included washes, and branch availability.</p>
        </div>
        <div className="flex items-center gap-3">
          <BranchFilter value={branch} onChange={setBranch} />
          <button className="btn-primary" data-testid="add-plan-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Add Plan</button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading plans…</div>
      ) : visiblePlans.length === 0 ? (
        <div className="card text-sm text-text-muted">{branch ? 'No plans available at this branch.' : 'No plans yet. Click "Add Plan" to create one.'}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visiblePlans.map((plan) => (
            <div key={plan.id} className="card relative" data-testid={`plan-row-${plan.id}`}>
              <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
              <p className="text-2xl font-bold text-primary-600 mt-2">Rp {plan.price.toLocaleString('id-ID')}</p>
              <p className="text-xs text-text-muted mt-1">{plan.durationMonths} month{plan.durationMonths > 1 ? 's' : ''}</p>
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex justify-between text-sm"><span className="text-text-secondary">Max Uses</span><span className="font-medium text-text-primary">{plan.maxUses} washes</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-secondary">Daily Limit</span><span className="font-medium text-text-primary">{plan.dailyLimit}/day</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-secondary">Max Plates</span><span className="font-medium text-text-primary">{plan.maxPlates} vehicles</span></div>
              </div>

              {plan.freeServiceIds && plan.freeServiceIds.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-text-secondary mb-1.5">Included free</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.freeServiceIds.map((id) => (
                      <span key={id} className="badge bg-green-50 text-green-700 text-xs">{serviceName(id)}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs font-medium text-text-secondary mb-1.5">Available at</p>
                {plan.outletIds && plan.outletIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {plan.outletIds.map((id) => (
                      <span key={id} className="badge bg-sky-50 text-sky-700 text-xs">{outletName(id)}</span>
                    ))}
                  </div>
                ) : (
                  <span className="badge bg-gray-100 text-gray-600 text-xs">All branches</span>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border flex gap-2">
                <button className="btn-secondary flex-1 text-xs" onClick={() => { setEditing(plan); setModalOpen(true); }}>Edit</button>
                <button className="btn-ghost text-xs text-error" onClick={() => handleDelete(plan.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <PlanModal initial={editing} services={services} outlets={outlets} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />
      )}
    </div>
  );
}
