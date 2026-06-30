'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface Overview {
  tenants: { total: number; active: number; suspended: number; cancelled: number; new30d: number };
  outlets: number; users: number; customers: number;
  ordersToday: number; revenueToday: number; revenue7d: number; revenue30d: number;
  activeMemberships: number; estimatedMrr: number; aiCalls30d: number;
}
interface Activity { at: string; operation: string; entityType: string; tenantName: string | null }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <p className="text-xs text-text-secondary uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-text-primary'}`}>{value}</p>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [o, a] = await Promise.all([
        api.get<Overview>('/admin/overview'),
        api.get<Activity[]>('/admin/activity?limit=15'),
      ]);
      setOv(o); setActivity(a);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

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
    <div data-testid="admin-overview">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Platform Overview</h1>
        <Link href="/admin/tenants" className="btn-primary">Manage Tenants →</Link>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {loading || !ov ? (
        <p className="text-text-muted">Loading…</p>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Stat label="Tenants" value={String(ov.tenants.total)} />
            <Stat label="Active / Suspended" value={`${ov.tenants.active} / ${ov.tenants.suspended}`} />
            <Stat label="Outlets" value={String(ov.outlets)} />
            <Stat label="Users" value={String(ov.users)} />
            <Stat label="Customers" value={String(ov.customers)} />
            <Stat label="Orders Today" value={String(ov.ordersToday)} />
            <Stat label="Revenue Today" value={fmt(ov.revenueToday)} accent="text-primary-600" />
            <Stat label="Revenue 30d (GMV)" value={fmt(ov.revenue30d)} accent="text-primary-600" />
            <Stat label="Active Memberships" value={String(ov.activeMemberships)} />
            <Stat label="Estimated MRR" value={fmt(ov.estimatedMrr)} accent="text-green-600" />
            <Stat label="AI Calls (30d)" value={ov.aiCalls30d.toLocaleString('id-ID')} />
            <Stat label="New Tenants (30d)" value={String(ov.tenants.new30d)} />
          </section>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Recent platform activity</h2>
              {activity.length === 0 ? (
                <p className="text-sm text-text-muted">No recent activity.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activity.map((a, i) => (
                    <li key={i} className="py-2 flex items-center justify-between text-sm">
                      <span className="text-text-primary">{a.operation.replace(/_/g, ' ')} · <span className="text-text-muted">{a.entityType}</span></span>
                      <span className="text-xs text-text-muted">{a.tenantName ?? '—'} · {new Date(a.at).toLocaleString('id-ID')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Quick links</h2>
              <div className="space-y-2 text-sm">
                <Link href="/admin/tenants" className="block text-primary-600 hover:underline">→ Tenants & rollups</Link>
                <Link href="/admin/monitoring" className="block text-primary-600 hover:underline">→ Operational monitoring</Link>
                <Link href="/admin/ai-usage" className="block text-primary-600 hover:underline">→ AI usage</Link>
                <Link href="/admin/billing" className="block text-primary-600 hover:underline">→ Billing & MRR</Link>
                <Link href="/admin/config" className="block text-primary-600 hover:underline">→ Platform config</Link>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
