'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, StatCard, Panel, ErrorBanner, TableWrap, EmptyRow, thCls, tdCls, fmtIDR, fmtPct } from '@/components/dashboard/ui';
import { BarChart } from '@/components/admin/charts';

interface Analytics {
  snapshot: { total: number; active: number; suspended: number; cancelled: number };
  churnRate: number;
  totalMrr: number;
  arr: number;
  cohorts: { month: string; signups: number; stillActive: number; retentionPct: number }[];
  mrrByPlan: { plan: string; activeTenants: number; monthlyPrice: number; mrr: number }[];
}

export default function AdminAnalyticsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<Analytics | null>(null);
  const [months, setMonths] = useState('12');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api.get<Analytics>(`/admin/analytics?months=${months}`)); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.analytics.failedToLoad', 'Failed to load analytics')); }
    finally { setLoading(false); }
  }, [months, t]);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (getUser()?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    load();
  }, [load]);

  return (
    <div className="space-y-6" data-testid="admin-analytics">
      <PageHeader
        title={t('admin.analytics.title', 'Growth Analytics')}
        subtitle={t('admin.analytics.subtitle', 'Tenant growth, retention cohorts, and recurring revenue across the platform.')}
        actions={
          <select className="input-field max-w-[140px]" value={months} onChange={(e) => setMonths(e.target.value)}>
            <option value="6">{t('admin.analytics.months6', '6 months')}</option>
            <option value="12">{t('admin.analytics.months12', '12 months')}</option>
            <option value="24">{t('admin.analytics.months24', '24 months')}</option>
          </select>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label={t('admin.analytics.totalTenants', 'Total tenants')} value={data ? String(data.snapshot.total) : '—'} loading={loading} />
        <StatCard label={t('admin.analytics.active', 'Active')} value={data ? String(data.snapshot.active) : '—'} tone="positive" loading={loading} />
        <StatCard label={t('admin.analytics.churnRate', 'Churn rate')} value={data ? fmtPct(data.churnRate) : '—'} tone="negative" loading={loading} hint={t('admin.analytics.churnHint', 'cancelled ÷ all-time')} />
        <StatCard label={t('admin.analytics.mrr', 'MRR')} value={data ? fmtIDR(data.totalMrr) : '—'} tone="primary" loading={loading} />
        <StatCard label={t('admin.analytics.arr', 'ARR')} value={data ? fmtIDR(data.arr) : '—'} tone="primary" loading={loading} />
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={t('admin.analytics.signupsPerMonth', 'Signups / month')} description={t('admin.analytics.signupsDesc', 'New tenants by signup month.')}>
          <BarChart
            data={(data?.cohorts ?? []).map((c) => ({ label: c.month, value: c.signups, tooltip: `${c.month}: ${c.signups} signups` }))}
            empty={t('admin.analytics.noData', 'No data.')}
          />
        </Panel>
        <Panel title={t('admin.analytics.retentionPerCohort', 'Retention / cohort')} description={t('admin.analytics.retentionDesc', 'Share of each signup cohort still active today.')}>
          <BarChart
            data={(data?.cohorts ?? []).map((c) => ({ label: c.month, value: c.retentionPct, tooltip: `${c.month}: ${c.retentionPct}% retained` }))}
            color="var(--color-green-500, #10b981)"
            empty={t('admin.analytics.noData', 'No data.')}
          />
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title={t('admin.analytics.mrrByPlan', 'MRR by plan')} bodyClassName="p-0">
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.analytics.plan', 'Plan')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.analytics.activeTenants', 'Active')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.analytics.pricePerMo', 'Price / mo')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.analytics.mrr', 'MRR')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!data || data.mrrByPlan.length === 0 ? (
                <EmptyRow colSpan={4}>{t('admin.analytics.noData', 'No data.')}</EmptyRow>
              ) : data.mrrByPlan.map((p) => (
                <tr key={p.plan}>
                  <td className={cn(tdCls, 'font-medium capitalize')}>{p.plan}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{p.activeTenants}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{p.monthlyPrice > 0 ? fmtIDR(p.monthlyPrice) : <span className="text-text-muted">—</span>}</td>
                  <td className={cn(tdCls, 'text-right font-medium tabular-nums')}>{fmtIDR(p.mrr)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>

        <Panel title={t('admin.analytics.cohortTable', 'Signup cohorts')} bodyClassName="p-0">
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.analytics.month', 'Month')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.analytics.signups', 'Signups')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.analytics.stillActive', 'Still active')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.analytics.retention', 'Retention')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!data || data.cohorts.length === 0 ? (
                <EmptyRow colSpan={4}>{t('admin.analytics.noData', 'No data.')}</EmptyRow>
              ) : [...data.cohorts].reverse().map((c) => (
                <tr key={c.month}>
                  <td className={cn(tdCls, 'font-medium')}>{c.month}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{c.signups}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{c.stillActive}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums', c.retentionPct >= 70 ? 'text-green-600' : c.retentionPct >= 40 ? 'text-amber-600' : 'text-rose-600')}>{c.retentionPct}%</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      </div>

      <p className="text-xs text-text-muted">{t('admin.analytics.note', 'Churn and retention are approximated from the current tenant snapshot (no status-change history is stored). MRR reads monthly-equivalent prices from subscription plans.')}</p>
    </div>
  );
}
