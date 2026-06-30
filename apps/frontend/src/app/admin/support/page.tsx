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

export default function AdminSupportPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  const needsAttention = tenants.filter((t) => t.status !== 'active');
  const filtered = tenants.filter((t) =>
    !query.trim() ||
    t.name.toLowerCase().includes(query.toLowerCase()) ||
    t.slug.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div data-testid="admin-support">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Support</h1>
        <button className="btn-ghost text-xs" onClick={load}>Refresh</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card"><p className="text-xs text-text-muted">Total tenants</p><p className="text-2xl font-bold text-text-primary mt-1">{tenants.length}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Active</p><p className="text-2xl font-bold text-green-600 mt-1">{tenants.filter((t) => t.status === 'active').length}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Needs attention</p><p className="text-2xl font-bold text-amber-600 mt-1">{needsAttention.length}</p></div>
      </div>

      {needsAttention.length > 0 && (
        <div className="card mb-6">
          <h2 className="section-title mb-3">Needs attention</h2>
          <div className="space-y-2">
            {needsAttention.map((t) => (
              <div key={t.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-text-primary">{t.name}</p>
                  <p className="text-xs text-text-muted">{t.slug} · {t.plan}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`badge ${STATUS_BADGE[t.status]} capitalize`}>{t.status}</span>
                  {t.status === 'suspended' && <button className="btn-ghost text-xs text-green-600" onClick={() => act(() => api.patch(`/admin/tenants/${t.id}/reactivate`))}>Reactivate</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <input className="input-field max-w-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tenants by name or slug…" />
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-gray-50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Tenant</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Plan</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Status</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Tenant ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-6 text-sm text-text-muted text-center">No matching tenants.</td></tr>
            ) : filtered.map((t) => (
              <tr key={t.id}>
                <td className="px-5 py-3.5 text-sm font-medium">{t.name}<span className="text-text-muted"> · {t.slug}</span></td>
                <td className="px-5 py-3.5 text-sm capitalize">{t.plan}</td>
                <td className="px-5 py-3.5"><span className={`badge ${STATUS_BADGE[t.status]} capitalize`}>{t.status}</span></td>
                <td className="px-5 py-3.5 text-xs text-text-muted font-mono">{t.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
