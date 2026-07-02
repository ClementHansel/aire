'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

interface Branch { id: string; name: string }
interface ServiceLite { id: string; name: string }
interface Promotion {
  id: string; name: string; description: string | null; startDate: string; endDate: string;
  isActive: boolean; outletIds: string[] | null; triggerServiceIds: string[] | null;
  rewardType: string; rewardValue: number; rewardServiceId: string | null; maxQuota: number | null; usedQuota: number;
}

const REWARD_TYPES = [
  { v: 'discount_fixed', l: 'Fixed discount (Rp)' },
  { v: 'discount_percentage', l: 'Percentage discount (%)' },
  { v: 'free_product', l: 'Free product/service' },
  { v: 'free_voucher', l: 'Free wash voucher' },
  { v: 'future_discount', l: 'Discount on a future purchase' },
];

function PromoModal({ initial, branches, services, onClose, onSaved }: { initial: Promotion | null; branches: Branch[]; services: ServiceLite[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(initial?.endDate ?? new Date().toISOString().slice(0, 10));
  const [rewardType, setRewardType] = useState(initial?.rewardType ?? 'discount_fixed');
  const [rewardValue, setRewardValue] = useState(String(initial?.rewardValue ?? 0));
  const [rewardServiceId, setRewardServiceId] = useState(initial?.rewardServiceId ?? '');
  const [maxQuota, setMaxQuota] = useState(initial?.maxQuota != null ? String(initial.maxQuota) : '');
  const [outletIds, setOutletIds] = useState<string[]>(initial?.outletIds ?? []);
  const [triggerServiceIds, setTriggerServiceIds] = useState<string[]>(initial?.triggerServiceIds ?? []);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name, description: description || undefined, startDate, endDate, isActive,
      outletIds, triggerServiceIds, rewardType,
      rewardValue: Number(rewardValue) || 0,
      rewardServiceId: rewardServiceId || null,
      maxQuota: maxQuota ? Number(maxQuota) : null,
    };
    try {
      if (initial) await api.put(`/promotions/${initial.id}`, payload);
      else await api.post('/promotions', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Promotion' : 'Add Promotion'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div><label className="block text-sm font-medium mb-1.5">Name</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label className="block text-sm font-medium mb-1.5">Description</label><input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Start date</label><input type="date" className="input-field" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">End date</label><input type="date" className="input-field" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Reward</label>
              <select className="input-field" value={rewardType} onChange={(e) => setRewardType(e.target.value)}>
                {REWARD_TYPES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium mb-1.5">Value</label><input type="number" className="input-field" value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} /></div>
          </div>
          {(rewardType === 'free_product' || rewardType === 'future_discount') && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Reward product/service</label>
              <select className="input-field" value={rewardServiceId} onChange={(e) => setRewardServiceId(e.target.value)}>
                <option value="">— select —</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">Max quota (blank = unlimited)</label><input type="number" className="input-field" value={maxQuota} onChange={(e) => setMaxQuota(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm text-text-secondary mt-7"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Applies to branches (none = all)</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-auto border border-border rounded-lg p-2">
              {branches.map((b) => <label key={b.id} className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={outletIds.includes(b.id)} onChange={() => toggle(outletIds, setOutletIds, b.id)} /> {b.name}</label>)}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Trigger products (none = any purchase)</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-auto border border-border rounded-lg p-2">
              {services.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={triggerServiceIds.includes(s.id)} onChange={() => toggle(triggerServiceIds, setTriggerServiceIds, s.id)} /> {s.name}</label>)}
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

export default function PromotionsPage() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [error, setError] = useState('');
  const [branch, setBranch] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Promotion | null }>({ open: false, editing: null });

  // Config filter: a promo with no outletIds (or empty) applies to every branch.
  const visiblePromos = promos.filter(
    (p) => !branch || !p.outletIds || p.outletIds.length === 0 || p.outletIds.includes(branch),
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, b, s] = await Promise.all([api.get<Promotion[]>('/promotions'), api.get<Branch[]>('/outlets'), api.get<ServiceLite[]>('/services')]);
      setPromos(p); setBranches(b); setServices(s);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm('Delete promotion?')) return;
    try { await api.delete(`/promotions/${id}`); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  const fmtReward = (p: Promotion) => {
    if (p.rewardType === 'discount_fixed') return `Rp ${p.rewardValue.toLocaleString('id-ID')} off`;
    if (p.rewardType === 'discount_percentage') return `${p.rewardValue}% off`;
    if (p.rewardType === 'free_product') return 'Free product';
    if (p.rewardType === 'free_voucher') return 'Free voucher';
    return 'Future discount';
  };

  return (
    <div data-testid="promotions-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Promotions</h1>
          <p className="mt-1 text-sm text-text-secondary">Discount or bundle rewards on qualifying purchases, per branch, with quota limits.</p>
        </div>
        <div className="flex items-center gap-3">
          <BranchFilter value={branch} onChange={setBranch} />
          <button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ Add Promotion</button>
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Promotion</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Reward</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Period</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Quota</th>
            <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">Status</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {visiblePromos.length === 0 ? <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">{branch ? 'No promotions apply to this branch.' : 'No promotions yet.'}</td></tr> : visiblePromos.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{p.name}<div className="text-xs text-text-muted">{p.description}</div></td>
                <td className="px-5 py-3.5 text-sm">{fmtReward(p)}</td>
                <td className="px-5 py-3.5 text-xs text-text-secondary">{p.startDate} → {p.endDate}</td>
                <td className="px-5 py-3.5 text-sm">{p.maxQuota != null ? `${p.usedQuota}/${p.maxQuota}` : '∞'}</td>
                <td className="px-5 py-3.5 text-center"><span className={`badge ${p.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.isActive ? 'Active' : 'Inactive'}</span></td>
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: p })}>Edit</button>
                  <button className="btn-ghost text-xs text-red-600" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal.open && <PromoModal initial={modal.editing} branches={branches} services={services} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}
    </div>
  );
}
