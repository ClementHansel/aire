'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

type Scope = 'global' | 'tenant' | 'branch';
interface TenantLite { id: string; name: string }
interface BranchLite { id: string; name: string }
interface Mon { totals: { orders: number; paid: number; cancelled: number; revenue: number; customers: number }; series: { day: string; orders: number; revenue: number }[] }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function Bars({ data, valueKey, color }: { data: { day: string; orders: number; revenue: number }[]; valueKey: 'orders' | 'revenue'; color: string }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return (
    <div className="flex items-end gap-1 h-32">
      {data.length === 0 ? <p className="text-sm text-text-muted">No data.</p> : data.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center justify-end" title={`${d.day}: ${valueKey === 'revenue' ? fmt(d.revenue) : d.orders}`}>
          <div style={{ height: `${(d[valueKey] / max) * 100}%`, background: color }} className="w-full rounded-t" />
        </div>
      ))}
    </div>
  );
}

export default function AdminMonitoringPage() {
  const [scope, setScope] = useState<Scope>('global');
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [outletId, setOutletId] = useState('');
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Mon | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } api.get<TenantLite[]>('/admin/tenants/enriched').then(setTenants).catch(() => {}); }, []);
  useEffect(() => {
    if (scope !== 'global' && tenantId) api.get<BranchLite[]>(`/admin/tenants/${tenantId}/branches`).then(setBranches).catch(() => setBranches([]));
  }, [scope, tenantId]);

  const load = useCallback(async () => {
    setError('');
    const qs = new URLSearchParams({ scope, days });
    if (scope !== 'global' && tenantId) qs.set('tenantId', tenantId);
    if (scope === 'branch' && outletId) qs.set('outletId', outletId);
    try { setData(await api.get<Mon>(`/admin/monitoring?${qs.toString()}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, [scope, tenantId, outletId, days]);
  useEffect(() => { load(); }, [load]);

  return (
    <div data-testid="admin-monitoring">
      <h1 className="text-2xl font-bold text-text-primary mb-4">Operational Monitoring</h1>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select className="input-field max-w-[160px]" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setOutletId(''); }}>
          <option value="global">Global (all tenants)</option>
          <option value="tenant">Per tenant</option>
          <option value="branch">Per branch</option>
        </select>
        {scope !== 'global' && (
          <select className="input-field max-w-[220px]" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOutletId(''); }}>
            <option value="">Select tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {scope === 'branch' && tenantId && (
          <select className="input-field max-w-[220px]" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select className="input-field max-w-[120px]" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
        </select>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {scope !== 'global' && !tenantId ? (
        <p className="text-text-muted">Select a tenant to view metrics.</p>
      ) : data ? (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Orders</p><p className="text-2xl font-bold mt-1">{data.totals.orders}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Paid</p><p className="text-2xl font-bold text-green-600 mt-1">{data.totals.paid}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Cancelled</p><p className="text-2xl font-bold text-red-600 mt-1">{data.totals.cancelled}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Revenue</p><p className="text-2xl font-bold text-primary-600 mt-1">{fmt(data.totals.revenue)}</p></div>
            <div className="bg-white rounded-xl border border-border p-4"><p className="text-xs text-text-secondary uppercase">Customers</p><p className="text-2xl font-bold mt-1">{data.totals.customers}</p></div>
          </section>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-border p-5"><h2 className="text-sm font-semibold mb-3">Revenue / day</h2><Bars data={data.series} valueKey="revenue" color="#1652F0" /></div>
            <div className="bg-white rounded-xl border border-border p-5"><h2 className="text-sm font-semibold mb-3">Orders / day</h2><Bars data={data.series} valueKey="orders" color="#10b981" /></div>
          </div>
        </>
      ) : <p className="text-text-muted">Loading…</p>}
    </div>
  );
}
