'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface Branch { id: string; name: string }
interface PaymentMethod {
  id: string; outletId: string | null; name: string; kind: string;
  businessUnit: 'AIRE' | 'LEAD' | null; logoUrl: string | null; color: string; sortOrder: number; isActive: boolean;
}

const KINDS = ['cash', 'qris', 'edc', 'cc', 'transfer'];

interface FormState { name: string; kind: string; businessUnit: '' | 'AIRE' | 'LEAD'; color: string; outletId: string; logoUrl: string; sortOrder: number }
const EMPTY: FormState = { name: '', kind: 'qris', businessUnit: '', color: '#1652F0', outletId: '', logoUrl: '', sortOrder: 0 };

function MethodModal({ initial, branches, onClose, onSaved }: { initial: PaymentMethod | null; branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(
    initial ? { name: initial.name, kind: initial.kind, businessUnit: initial.businessUnit ?? '', color: initial.color, outletId: initial.outletId ?? '', logoUrl: initial.logoUrl ?? '', sortOrder: initial.sortOrder } : EMPTY,
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
      outletId: form.outletId || null, sortOrder: Number(form.sortOrder),
    };
    try {
      if (initial) await api.put(`/payment-methods/${initial.id}`, payload);
      else await api.post('/payment-methods', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? 'Edit Payment Method' : 'Add Payment Method'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Name (as shown on the POS button)</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. EDC BRI / QRIS BCA" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Kind</label>
              <select className="input-field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Settles to</label>
              <select className="input-field" value={form.businessUnit} onChange={(e) => setForm({ ...form, businessUnit: e.target.value as FormState['businessUnit'] })}>
                <option value="">n/a (e.g. cash)</option>
                <option value="AIRE">AIRE</option>
                <option value="LEAD">LEAD</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Color</label>
              <input type="color" className="input-field h-10 p-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Branch</label>
              <select className="input-field" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
                <option value="">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Logo URL (optional)</label>
            <input className="input-field" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/bri.png" />
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

export default function PaymentMethodsPage() {
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
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm('Delete this payment method?')) return;
    try { await api.delete(`/payment-methods/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  };

  const branchName = (id: string | null) => id ? (branches.find((b) => b.id === id)?.name ?? '—') : 'All branches';

  return (
    <div data-testid="payment-methods-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Payment Methods</h1>
          <p className="mt-1 text-sm text-text-secondary">Configure per-branch payment buttons (with colour + logo) shown on the POS.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Add Method</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {methods.length === 0 ? (
            <div className="card text-sm text-text-muted col-span-full">No payment methods yet.</div>
          ) : methods.map((m) => (
            <div key={m.id} className="card flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: m.color }}>
                {m.logoUrl ? <img src={m.logoUrl} alt="" className="w-7 h-7 object-contain" /> : m.kind.toUpperCase().slice(0, 3)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary text-sm truncate">{m.name}</p>
                <p className="text-xs text-text-muted">{m.kind.toUpperCase()}{m.businessUnit ? ` · ${m.businessUnit}` : ''} · {branchName(m.outletId)}</p>
              </div>
              <div className="flex flex-col gap-1">
                <button className="btn-ghost text-xs py-1" onClick={() => { setEditing(m); setModalOpen(true); }}>Edit</button>
                <button className="btn-ghost text-xs py-1 text-red-600" onClick={() => remove(m.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && <MethodModal initial={editing} branches={branches} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
