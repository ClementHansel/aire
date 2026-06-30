'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

type TenantStatus = 'active' | 'suspended' | 'cancelled';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: TenantStatus;
  createdAt: string;
}

const STATUS_BADGE: Record<TenantStatus, string> = {
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-amber-50 text-amber-700',
  cancelled: 'bg-red-50 text-red-700',
};

interface FormState { name: string; slug: string; plan: string }

function TenantModal({ initial, onClose, onSaved }: { initial: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(initial ? { name: initial.name, slug: initial.slug, plan: initial.plan } : { name: '', slug: '', plan: 'standard' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (initial) await api.put(`/admin/tenants/${initial.id}`, form);
      else await api.post('/admin/tenants', form);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{initial ? 'Edit Tenant' : 'Create Tenant'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">Name</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Slug</label>
            <input className="input-field" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Plan</label>
            <select className="input-field" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
              <option value="enterprise">Enterprise</option>
            </select>
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

export default function AdminDashboardPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.get<Tenant[]>('/admin/tenants');
      setTenants(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load tenants';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
  };

  if (loading) return <p className="text-text-muted">Loading…</p>;

  if (forbidden) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-text-primary mb-2">Access Denied</h1>
        <p className="text-sm text-text-secondary">This area requires a Platform Super Admin account. You are signed in as <span className="font-medium">{getUser()?.role?.replace(/_/g, ' ')}</span>.</p>
        <button onClick={logout} className="btn-secondary mt-4">Sign in as different user</button>
      </div>
    );
  }

  return (
    <div data-testid="admin-dashboard">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Platform Admin</h1>
        <div className="flex items-center gap-3">
          <button className="btn-primary" data-testid="create-tenant-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Create Tenant</button>
          <button className="btn-ghost text-xs" onClick={logout}>Sign out</button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full" data-testid="tenant-table">
          <thead>
            <tr className="border-b border-border bg-gray-50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Name</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Status</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Plan</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tenants.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-6 text-sm text-text-muted text-center">No tenants yet.</td></tr>
            ) : tenants.map((t) => (
              <tr key={t.id} data-testid={`tenant-row-${t.id}`}>
                <td className="px-5 py-3.5 text-sm font-medium">{t.name}</td>
                <td className="px-5 py-3.5"><span className={`badge ${STATUS_BADGE[t.status]} capitalize`}>{t.status}</span></td>
                <td className="px-5 py-3.5 text-sm capitalize">{t.plan}</td>
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => { setEditing(t); setModalOpen(true); }}>Edit</button>
                  {t.status === 'active' && <button className="btn-ghost text-xs text-amber-600" onClick={() => act(() => api.patch(`/admin/tenants/${t.id}/suspend`))}>Suspend</button>}
                  {t.status === 'suspended' && <button className="btn-ghost text-xs text-green-600" onClick={() => act(() => api.patch(`/admin/tenants/${t.id}/reactivate`))}>Reactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && <TenantModal initial={editing} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
