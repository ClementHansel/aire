'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';

interface Tenant {
  id: string;
  name: string;
  plan: string;
  status: 'active' | 'suspended' | 'cancelled';
}

interface PlatformConfig {
  pricingTiers: { plan: string; price: number }[];
}

interface PlanRow {
  plan: string;
  price: number;
  total: number;
  active: number;
  mrr: number;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function AdminBillingPage() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [mrr, setMrr] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [tenants, config] = await Promise.all([
        api.get<Tenant[]>('/admin/tenants'),
        api.get<PlatformConfig>('/admin/config'),
      ]);
      const priceOf = (plan: string) =>
        Number((config.pricingTiers ?? []).find((t) => t.plan === plan)?.price ?? 0);

      const byPlan = new Map<string, PlanRow>();
      for (const t of tenants) {
        const key = t.plan || 'unspecified';
        const row = byPlan.get(key) ?? { plan: key, price: priceOf(key), total: 0, active: 0, mrr: 0 };
        row.total += 1;
        if (t.status === 'active') { row.active += 1; row.mrr += row.price; }
        byPlan.set(key, row);
      }
      const planRows = Array.from(byPlan.values()).sort((a, b) => b.mrr - a.mrr);
      setRows(planRows);
      setMrr(planRows.reduce((s, r) => s + r.mrr, 0));
      setActiveCount(tenants.filter((t) => t.status === 'active').length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load billing data';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
  }, [load]);

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
    <div data-testid="admin-billing">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Billing</h1>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card"><p className="text-xs text-text-muted">Estimated MRR</p><p className="text-2xl font-bold text-text-primary mt-1">{fmt(mrr)}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Active subscriptions</p><p className="text-2xl font-bold text-text-primary mt-1">{activeCount}</p></div>
        <div className="card"><p className="text-xs text-text-muted">Annual run rate</p><p className="text-2xl font-bold text-text-primary mt-1">{fmt(mrr * 12)}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-gray-50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">Plan</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Price / mo</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Tenants</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">Active</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">MRR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-6 text-sm text-text-muted text-center">No tenants yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.plan}>
                <td className="px-5 py-3.5 text-sm font-medium capitalize">{r.plan}</td>
                <td className="px-5 py-3.5 text-sm text-right">{r.price > 0 ? fmt(r.price) : <span className="text-text-muted">not set</span>}</td>
                <td className="px-5 py-3.5 text-sm text-right">{r.total}</td>
                <td className="px-5 py-3.5 text-sm text-right">{r.active}</td>
                <td className="px-5 py-3.5 text-sm text-right font-medium">{fmt(r.mrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted mt-3">MRR is estimated from active tenants and the pricing tiers configured under Platform Config.</p>
    </div>
  );
}
