'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface ServiceDTO {
  id: string;
  tenantId: string;
  outletId: string | null;
  name: string;
  category: 'car_wash' | 'product' | 'add_on';
  businessUnit: 'AIRE' | 'LEAD';
  price: number;
  isActive: boolean;
  isMainService: boolean;
  sortOrder: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  car_wash: 'Car Wash',
  product: 'Product',
  add_on: 'Add-on',
};

interface FormState {
  name: string;
  category: ServiceDTO['category'];
  businessUnit: ServiceDTO['businessUnit'];
  price: string;
  isActive: boolean;
  isMainService: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'car_wash',
  businessUnit: 'AIRE',
  price: '',
  isActive: true,
  isMainService: false,
};

function ServiceModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: ServiceDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          category: initial.category,
          businessUnit: initial.businessUnit ?? 'AIRE',
          price: String(initial.price),
          isActive: initial.isActive,
          isMainService: initial.isMainService,
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
      category: form.category,
      businessUnit: form.businessUnit,
      price: Number(form.price),
      isActive: form.isActive,
      isMainService: form.isMainService,
    };
    try {
      if (initial) {
        await api.put(`/services/${initial.id}`, payload);
      } else {
        await api.post('/services', payload);
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
        <h3 className="section-title mb-4">{initial ? 'Edit Service' : 'Add Service'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Name</label>
            <input aria-label="Name" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Business unit</label>
            <select aria-label="Business Unit" className="input-field" value={form.businessUnit} onChange={(e) => setForm({ ...form, businessUnit: e.target.value as ServiceDTO['businessUnit'] })}>
              <option value="AIRE">AIRE · Car Wash</option>
              <option value="LEAD">LEAD · Detailing &amp; Polishing</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Category</label>
            <select aria-label="Category" className="input-field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ServiceDTO['category'] })}>
              <option value="car_wash">Car Wash</option>
              <option value="add_on">Add-on</option>
              <option value="product">Product</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Price (Rp)</label>
            <input aria-label="Price" type="number" min="0" className="input-field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={form.isMainService} onChange={(e) => setForm({ ...form, isMainService: e.target.checked })} />
              Main service
            </label>
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

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<ServiceDTO[]>('/services');
      setServices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this service?')) return;
    try {
      await api.delete(`/services/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (s: ServiceDTO) => { setEditing(s); setModalOpen(true); };

  return (
    <div data-testid="services-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="services-title">Services</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage your service menu and pricing.</p>
        </div>
        <button className="btn-primary" data-testid="add-service-btn" onClick={openAdd}>+ Add Service</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">Loading services…</div>
      ) : services.length === 0 ? (
        <div className="card text-sm text-text-muted">No services yet. Click &quot;Add Service&quot; to create one.</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full" data-testid="services-table">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Unit</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Category</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Price</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunken/30 transition-colors" data-testid={`service-row-${s.id}`}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{s.name}</td>
                  <td className="px-5 py-3.5"><span className={`badge ${s.businessUnit === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{s.businessUnit ?? 'AIRE'}</span></td>
                  <td className="px-5 py-3.5"><span className="badge bg-primary-50 text-primary-700">{CATEGORY_LABELS[s.category]}</span></td>
                  <td className="px-5 py-3.5 text-sm text-text-primary text-right font-mono">Rp {s.price.toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`badge ${s.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.isActive ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => openEdit(s)}>Edit</button>
                    <button className="btn-ghost text-xs text-error" onClick={() => handleDelete(s.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ServiceModal
          initial={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
