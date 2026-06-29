'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface MembershipPlan {
  id: string;
  tenantId: string;
  name: string;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  price: number;
  isActive: boolean;
}

interface FormState {
  name: string;
  durationMonths: 1 | 3 | 12;
  maxUses: string;
  dailyLimit: string;
  maxPlates: string;
  price: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  durationMonths: 1,
  maxUses: '10',
  dailyLimit: '1',
  maxPlates: '3',
  price: '',
};

function PlanModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: MembershipPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          durationMonths: initial.durationMonths as 1 | 3 | 12,
          maxUses: String(initial.maxUses),
          dailyLimit: String(initial.dailyLimit),
          maxPlates: String(initial.maxPlates),
          price: String(initial.price),
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Plan' : 'Create Plan'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Plan Name</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Duration</label>
            <select className="input-field" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: Number(e.target.value) as 1 | 3 | 12 })}>
              <option value={1}>1 month</option>
              <option value={3}>3 months</option>
              <option value={12}>12 months</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Max Uses</label>
              <input type="number" min="1" className="input-field" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Daily</label>
              <input type="number" min="1" className="input-field" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Plates</label>
              <input type="number" min="1" className="input-field" value={form.maxPlates} onChange={(e) => setForm({ ...form, maxPlates: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Price (Rp)</label>
            <input type="number" min="0" className="input-field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MembershipPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<MembershipPlan[]>('/membership-plans');
      setPlans(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
          <p className="mt-1 text-sm text-text-secondary">Configure plans, quotas, and pricing for your members.</p>
        </div>
        <button className="btn-primary" data-testid="add-plan-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Add Plan</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading plans…</div>
      ) : plans.length === 0 ? (
        <div className="card text-sm text-text-muted">No plans yet. Click &quot;Add Plan&quot; to create one.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="card relative" data-testid={`plan-row-${plan.id}`}>
              <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
              <p className="text-2xl font-bold text-primary-600 mt-2">Rp {plan.price.toLocaleString('id-ID')}</p>
              <p className="text-xs text-text-muted mt-1">{plan.durationMonths} month{plan.durationMonths > 1 ? 's' : ''}</p>
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex justify-between text-sm"><span className="text-text-secondary">Max Uses</span><span className="font-medium text-text-primary">{plan.maxUses} washes</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-secondary">Daily Limit</span><span className="font-medium text-text-primary">{plan.dailyLimit}/day</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-secondary">Max Plates</span><span className="font-medium text-text-primary">{plan.maxPlates} vehicles</span></div>
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
        <PlanModal initial={editing} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />
      )}
    </div>
  );
}
