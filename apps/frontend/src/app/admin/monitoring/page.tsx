'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { PageHeader, StatCard, Panel, ErrorBanner, fmtIDR } from '@/components/dashboard/ui';
import { BarChart } from '@/components/admin/charts';

type Scope = 'global' | 'tenant' | 'branch';
interface TenantLite { id: string; name: string }
interface BranchLite { id: string; name: string }
interface Mon { totals: { orders: number; paid: number; cancelled: number; revenue: number; customers: number }; series: { day: string; orders: number; revenue: number }[] }

export default function AdminMonitoringPage() {
  const { t } = useI18n();
  const isSuper = getUser()?.role === 'platform_super_admin';
  const myTenant = getUser()?.tenantId ?? '';
  const [scope, setScope] = useState<Scope>(isSuper ? 'global' : 'tenant');
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [tenantId, setTenantId] = useState(isSuper ? '' : myTenant);
  const [outletId, setOutletId] = useState('');
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Mon | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (isSuper) api.get<TenantLite[]>('/admin/tenants/enriched').then(setTenants).catch(() => {});
  }, [isSuper]);
  useEffect(() => {
    if (scope !== 'global' && tenantId) api.get<BranchLite[]>(`/admin/tenants/${tenantId}/branches`).then(setBranches).catch(() => setBranches([]));
  }, [scope, tenantId]);

  const load = useCallback(async () => {
    setError('');
    const qs = new URLSearchParams({ scope, days });
    if (scope !== 'global' && tenantId) qs.set('tenantId', tenantId);
    if (scope === 'branch' && outletId) qs.set('outletId', outletId);
    try { setData(await api.get<Mon>(`/admin/monitoring?${qs.toString()}`)); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.monitoring.failedToLoad', 'Failed to load')); }
  }, [scope, tenantId, outletId, days, t]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="admin-monitoring">
      <PageHeader
        title={t('admin.monitoring.title', 'Operational Monitoring')}
        subtitle={t('admin.monitoring.subtitle', 'Orders, revenue, and customers across the platform or a single tenant / branch.')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className="input-field max-w-[180px]" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setOutletId(''); }}>
          {isSuper && <option value="global">{t('admin.monitoring.scopeGlobal', 'Global (all tenants)')}</option>}
          <option value="tenant">{isSuper ? t('admin.monitoring.scopePerTenant', 'Per tenant') : t('admin.monitoring.scopeMyBusiness', 'My business')}</option>
          <option value="branch">{t('admin.monitoring.scopePerBranch', 'Per branch')}</option>
        </select>
        {isSuper && scope !== 'global' && (
          <select className="input-field max-w-[220px]" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOutletId(''); }}>
            <option value="">{t('admin.monitoring.selectTenant', 'Select tenant…')}</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        )}
        {scope === 'branch' && tenantId && (
          <select className="input-field max-w-[220px]" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">{t('admin.monitoring.selectBranch', 'Select branch…')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select className="input-field max-w-[120px]" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">{t('admin.monitoring.days7', '7 days')}</option><option value="30">{t('admin.monitoring.days30', '30 days')}</option><option value="90">{t('admin.monitoring.days90', '90 days')}</option>
        </select>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {scope !== 'global' && !tenantId ? (
        <p className="text-text-muted">{t('admin.monitoring.selectTenantMetrics', 'Select a tenant to view metrics.')}</p>
      ) : data ? (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label={t('admin.monitoring.orders', 'Orders')} value={String(data.totals.orders)} />
            <StatCard label={t('admin.monitoring.paid', 'Paid')} value={String(data.totals.paid)} tone="positive" />
            <StatCard label={t('admin.monitoring.cancelled', 'Cancelled')} value={String(data.totals.cancelled)} tone="negative" />
            <StatCard label={t('admin.monitoring.revenue', 'Revenue')} value={fmtIDR(data.totals.revenue)} tone="primary" />
            <StatCard label={t('admin.monitoring.customers', 'Customers')} value={String(data.totals.customers)} />
          </section>
          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title={t('admin.monitoring.revenuePerDay', 'Revenue / day')}>
              <BarChart data={data.series.map((d) => ({ label: d.day, value: d.revenue, tooltip: `${d.day}: ${fmtIDR(d.revenue)}` }))} empty={t('admin.monitoring.noData', 'No data.')} />
            </Panel>
            <Panel title={t('admin.monitoring.ordersPerDay', 'Orders / day')}>
              <BarChart data={data.series.map((d) => ({ label: d.day, value: d.orders }))} color="var(--color-green-500, #10b981)" empty={t('admin.monitoring.noData', 'No data.')} />
            </Panel>
          </div>
        </>
      ) : <p className="text-text-muted">{t('admin.monitoring.loading', 'Loading…')}</p>}
    </div>
  );
}
