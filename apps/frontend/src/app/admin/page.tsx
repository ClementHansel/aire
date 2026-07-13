'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { PageHeader, StatCard, Panel, ErrorBanner, fmtIDR, fmtDateTime } from '@/components/dashboard/ui';
import { BarChart } from '@/components/admin/charts';

interface Overview {
  tenants: { total: number; active: number; suspended: number; cancelled: number; new30d: number };
  outlets: number; users: number; customers: number;
  ordersToday: number; revenueToday: number; revenue7d: number; revenue30d: number;
  activeMemberships: number; estimatedMrr: number; aiCalls30d: number;
}
interface Activity { at: string; operation: string; entityType: string; tenantName: string | null }
interface Timeseries { revenue: { day: string; revenue: number; orders: number }[]; tenants: { day: string; n: number }[] }

export default function AdminOverviewPage() {
  const { t } = useI18n();
  const [ov, setOv] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [ts, setTs] = useState<Timeseries | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [o, a, series] = await Promise.all([
        api.get<Overview>('/admin/overview'),
        api.get<Activity[]>('/admin/activity?limit=15'),
        api.get<Timeseries>('/admin/timeseries?days=30'),
      ]);
      setOv(o); setActivity(a); setTs(series);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.home.failedToLoad', 'Failed to load');
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  if (forbidden) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-text-primary mb-2">{t('admin.home.accessDenied', 'Access Denied')}</h1>
        <p className="text-sm text-text-secondary">{t('admin.home.accessDeniedDesc', 'This area requires a Platform Super Admin account. You are signed in as ')}<span className="font-medium">{getUser()?.role?.replace(/_/g, ' ')}</span>.</p>
        <button onClick={logout} className="btn-secondary mt-4">{t('admin.home.signInDifferent', 'Sign in as different user')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-overview">
      <PageHeader
        title={t('admin.home.title', 'Platform Overview')}
        subtitle={t('admin.home.subtitle', 'Health of the whole platform — tenants, revenue, and activity at a glance.')}
        actions={<Link href="/admin/tenants" className="btn-primary">{t('admin.home.manageTenants', 'Manage Tenants')} →</Link>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('admin.home.statTenants', 'Tenants')} value={ov ? String(ov.tenants.total) : '—'} loading={loading} hint={ov ? t('admin.home.newTenantsHint', '{n} new in 30d').replace('{n}', String(ov.tenants.new30d)) : undefined} />
        <StatCard label={t('admin.home.statActiveSuspended', 'Active / Suspended')} value={ov ? `${ov.tenants.active} / ${ov.tenants.suspended}` : '—'} loading={loading} />
        <StatCard label={t('admin.home.statOutlets', 'Outlets')} value={ov ? String(ov.outlets) : '—'} loading={loading} />
        <StatCard label={t('admin.home.statUsers', 'Users')} value={ov ? String(ov.users) : '—'} loading={loading} />
        <StatCard label={t('admin.home.statCustomers', 'Customers')} value={ov ? ov.customers.toLocaleString('id-ID') : '—'} loading={loading} />
        <StatCard label={t('admin.home.statOrdersToday', 'Orders Today')} value={ov ? String(ov.ordersToday) : '—'} loading={loading} />
        <StatCard label={t('admin.home.statRevenueToday', 'Revenue Today')} value={ov ? fmtIDR(ov.revenueToday) : '—'} tone="primary" loading={loading} />
        <StatCard label={t('admin.home.statRevenue30d', 'Revenue 30d (GMV)')} value={ov ? fmtIDR(ov.revenue30d) : '—'} tone="primary" loading={loading} />
        <StatCard label={t('admin.home.statActiveMemberships', 'Active Memberships')} value={ov ? String(ov.activeMemberships) : '—'} loading={loading} />
        <StatCard label={t('admin.home.statEstimatedMrr', 'Estimated MRR')} value={ov ? fmtIDR(ov.estimatedMrr) : '—'} tone="positive" loading={loading} />
        <StatCard label={t('admin.home.statAiCalls', 'AI Calls (30d)')} value={ov ? ov.aiCalls30d.toLocaleString('id-ID') : '—'} loading={loading} />
        <StatCard label={t('admin.home.statNewTenants', 'New Tenants (30d)')} value={ov ? String(ov.tenants.new30d) : '—'} loading={loading} />
      </section>

      {ts && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title={t('admin.home.revenuePerDay', 'Platform revenue / day (30d)')}>
            <BarChart data={ts.revenue.map((d) => ({ label: d.day, value: d.revenue, tooltip: `${d.day}: ${fmtIDR(d.revenue)}` }))} empty={t('admin.home.noData', 'No data.')} />
          </Panel>
          <Panel title={t('admin.home.newTenantsPerDay', 'New tenants / day (30d)')}>
            <BarChart data={ts.tenants.map((d) => ({ label: d.day, value: d.n }))} color="var(--color-green-500, #10b981)" empty={t('admin.home.noData', 'No data.')} />
          </Panel>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title={t('admin.home.recentActivity', 'Recent platform activity')} className="lg:col-span-2">
          {activity.length === 0 ? (
            <p className="text-sm text-text-muted">{t('admin.home.noRecentActivity', 'No recent activity.')}</p>
          ) : (
            <ul className="divide-y divide-border -my-2">
              {activity.map((a, i) => (
                <li key={i} className="py-2 flex items-center justify-between text-sm gap-3">
                  <span className="text-text-primary capitalize truncate">{a.operation.replace(/_/g, ' ')} · <span className="text-text-muted">{a.entityType}</span></span>
                  <span className="text-xs text-text-muted whitespace-nowrap">{a.tenantName ?? '—'} · {fmtDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('admin.home.quickLinks', 'Quick links')}>
          <div className="space-y-2 text-sm">
            <Link href="/admin/tenants" className="block text-primary-600 hover:underline">→ {t('admin.home.linkTenants', 'Tenants & rollups')}</Link>
            <Link href="/admin/monitoring" className="block text-primary-600 hover:underline">→ {t('admin.home.linkMonitoring', 'Operational monitoring')}</Link>
            <Link href="/admin/ai-usage" className="block text-primary-600 hover:underline">→ {t('admin.home.linkAiUsage', 'AI usage')}</Link>
            <Link href="/admin/billing" className="block text-primary-600 hover:underline">→ {t('admin.home.linkBilling', 'Billing & MRR')}</Link>
            <Link href="/admin/config" className="block text-primary-600 hover:underline">→ {t('admin.home.linkConfig', 'Platform config')}</Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
