'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

type TenantStatus = 'active' | 'suspended' | 'cancelled';
interface Tenant {
  id: string; name: string; slug: string; plan: string; status: TenantStatus;
  outlets: number; users: number; orders30d: number; revenue30d: number; lastOrderAt: string | null;
}
const STATUS_BADGE: Record<TenantStatus, string> = {
  active: 'bg-green-50 text-green-700', suspended: 'bg-amber-50 text-amber-700', cancelled: 'bg-red-50 text-red-700',
};
const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function TenantModal({ initial, onClose, onSaved }: { initial: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', slug: initial?.slug ?? '', plan: initial?.plan ?? 'standard' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (initial) await api.put(`/admin/tenants/${initial.id}`, form);
      else await api.post('/admin/tenants', form);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{initial ? 'Edit Tenant' : 'Create Tenant'}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div><label className="block text-sm font-medium mb-1.5">Name</label><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="block text-sm font-medium mb-1.5">Slug</label><input className="input-field" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required /></div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Plan</label>
            <select className="input-field" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              <option value="standard">Standard</option><option value="premium">Premium</option><option value="enterprise">Enterprise</option>
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

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Tenant | null }>({ open: false, editing: null });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setTenants(await api.get<Tenant[]>('/admin/tenants/enriched')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load tenants'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
  };

  const filtered = tenants.filter((t) =>
    (statusFilter === 'all' || t.status === statusFilter) &&
    (q.trim() === '' || t.name.toLowerCase().includes(q.toLowerCase()) || t.slug.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div data-testid="admin-tenants">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-text-primary">Tenants</h1>
        <button className="btn-primary" data-testid="create-tenant-btn" onClick={() => setModal({ open: true, editing: null })}>+ Create Tenant</button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <input className="input-field max-w-xs" placeholder="Search name / slug…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input-field max-w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? <p className="text-text-muted">Loading…</p> : (
        <div className="bg-white rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full" data-testid="tenant-table">
            <thead><tr className="border-b border-border bg-gray-50">
              {['Name', 'Status', 'Plan', 'Outlets', 'Users', 'Orders 30d', 'Revenue 30d', 'Last order', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-text-secondary uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-5 py-6 text-sm text-text-muted text-center">No tenants.</td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id} data-testid={`tenant-row-${t.id}`}>
                  <td className="px-4 py-3 text-sm font-medium"><Link href={`/admin/tenants/${t.id}`} className="text-primary-600 hover:underline">{t.name}</Link></td>
                  <td className="px-4 py-3"><span className={`badge ${STATUS_BADGE[t.status]} capitalize`}>{t.status}</span></td>
                  <td className="px-4 py-3 text-sm capitalize">{t.plan}</td>
                  <td className="px-4 py-3 text-sm text-right">{t.outlets}</td>
                  <td className="px-4 py-3 text-sm text-right">{t.users}</td>
                  <td className="px-4 py-3 text-sm text-right">{t.orders30d}</td>
                  <td className="px-4 py-3 text-sm text-right">{fmt(t.revenue30d)}</td>
                  <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">{t.lastOrderAt ? new Date(t.lastOrderAt).toLocaleDateString('id-ID') : '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: t })}>Edit</button>
                    {t.status === 'active' && <button className="btn-ghost text-xs text-amber-600" onClick={() => act(() => api.patch(`/admin/tenants/${t.id}/suspend`))}>Suspend</button>}
                    {t.status === 'suspended' && <button className="btn-ghost text-xs text-green-600" onClick={() => act(() => api.patch(`/admin/tenants/${t.id}/reactivate`))}>Reactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && <TenantModal initial={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}
    </div>
  );
}
