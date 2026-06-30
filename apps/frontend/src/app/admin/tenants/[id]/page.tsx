'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, startImpersonation, type AuthUser } from '@/lib/auth';

interface Detail {
  tenant: { id: string; name: string; slug: string; plan: string; status: string; created_at: string };
  outlets: { id: string; name: string; code: string | null; is_active: boolean; phone: string | null }[];
  users: { id: string; name: string; email: string; role: string }[];
  stats: { orders30d: number; revenue30d: number; activeMembers: number; customers: number };
}
const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function TenantDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setD(await api.get<Detail>(`/admin/tenants/${id}/detail`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const impersonate = async () => {
    if (!confirm('Impersonate this tenant? You will act as their owner until you stop. This is audited.')) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ accessToken: string; user: AuthUser }>(`/admin/tenants/${id}/impersonate`, {});
      startImpersonation(res.accessToken, res.user);
      window.location.href = '/hub';
    } catch (err) { setError(err instanceof Error ? err.message : 'Impersonation failed'); setBusy(false); }
  };

  if (loading) return <p className="text-text-muted">Loading…</p>;
  if (error && !d) return <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>;
  if (!d) return <p className="text-text-muted">Not found.</p>;

  return (
    <div data-testid="tenant-detail">
      <Link href="/admin/tenants" className="text-sm text-primary-600 hover:underline">← All tenants</Link>
      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{d.tenant.name}</h1>
          <p className="text-sm text-text-muted capitalize">{d.tenant.plan} · {d.tenant.status} · since {new Date(d.tenant.created_at).toLocaleDateString('id-ID')}</p>
        </div>
        <button className="btn-primary" onClick={impersonate} disabled={busy}>{busy ? 'Starting…' : '👤 Impersonate'}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Orders 30d</p><p className="text-2xl font-bold mt-1">{d.stats.orders30d}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Revenue 30d</p><p className="text-2xl font-bold text-primary-600 mt-1">{fmt(d.stats.revenue30d)}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Active members</p><p className="text-2xl font-bold mt-1">{d.stats.activeMembers}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Customers</p><p className="text-2xl font-bold mt-1">{d.stats.customers}</p></div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold mb-3">Branches ({d.outlets.length})</h2>
          {d.outlets.length === 0 ? <p className="text-sm text-text-muted">No branches.</p> : (
            <ul className="divide-y divide-border">
              {d.outlets.map((o) => (
                <li key={o.id} className="py-2 flex items-center justify-between text-sm">
                  <span>{o.name} <span className="text-xs text-text-muted">{o.code ?? ''}</span></span>
                  <span className={`badge ${o.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{o.is_active ? 'Active' : 'Inactive'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold mb-3">Users ({d.users.length})</h2>
          {d.users.length === 0 ? <p className="text-sm text-text-muted">No users.</p> : (
            <ul className="divide-y divide-border">
              {d.users.map((u) => (
                <li key={u.id} className="py-2 flex items-center justify-between text-sm">
                  <span>{u.name}<div className="text-xs text-text-muted">{u.email}</div></span>
                  <span className="badge bg-surface-sunken text-text-secondary capitalize">{u.role.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
