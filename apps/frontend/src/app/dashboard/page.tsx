'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ShowerHead, CreditCard, TrendingUp, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import BranchFilter from '@/components/dashboard/BranchFilter';
import ProposalsWidget from './ProposalsWidget';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

interface Summary { totalOrders: number; revenue: number; uniqueMembers: number }
interface OutletLite { id: string; name: string }
interface Forecast { period: string; actual: number; projected: number; target: number; attainmentPct: number | null; projectedAttainmentPct: number | null; }

export default function DashboardHomePage() {
  const { t } = useI18n();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [outletList, setOutletList] = useState<OutletLite[]>([]);
  const [branch, setBranch] = useState<string>(''); // '' = all branches (global)
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);

  useEffect(() => {
    const u = getUser();
    if (u) setTenantId(u.tenantId);
    api.get<OutletLite[]>('/outlets').then(setOutletList).catch(() => setOutletList([]));
  }, []);

  useEffect(() => {
    const d = today();
    setSummary(null);
    const qs = `dateFrom=${d}&dateTo=${d}${branch ? `&outletId=${branch}` : ''}`;
    api.get<Summary>(`/reports/summary?${qs}`).then(setSummary).catch(() => setSummary(null));
    setForecast(null);
    api.get<Forecast>(`/sales/summary${branch ? `?outletId=${branch}` : ''}`).then(setForecast).catch(() => setForecast(null));
  }, [branch]);

  const stat = (v: number | null | undefined, render: (n: number) => string = (n) => String(n)) =>
    v == null ? '—' : render(v);

  return (
    <div data-testid="dashboard-home">
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="dashboard-home-title">
            {t('dash.overview.title', 'Dashboard Overview')}
          </h1>
          <p className="mt-1 text-sm text-text-secondary" data-testid="dashboard-home-description">
            {t('dash.overview.description', 'Manage your outlets, services, memberships, and view reports from here.')}
          </p>
        </div>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>

      {/* Quick Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-testid="dashboard-quick-stats">
        <div className="card" data-testid="stat-outlets">
          <p className="text-sm text-text-secondary">{t('dash.overview.outlets', 'Outlets')}</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(outletList.length || null)}</p>
        </div>
        <div className="card" data-testid="stat-active-members">
          <p className="text-sm text-text-secondary">{t('dash.overview.membersServedToday', 'Members Served (Today)')}</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(summary?.uniqueMembers)}</p>
        </div>
        <div className="card" data-testid="stat-today-orders">
          <p className="text-sm text-text-secondary">{t('dash.overview.todaysOrders', "Today's Orders")}</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stat(summary?.totalOrders)}</p>
        </div>
        <div className="card" data-testid="stat-revenue">
          <p className="text-sm text-text-secondary">{t('dash.overview.revenueToday', 'Revenue (Today)')}</p>
          <p className="text-2xl font-bold text-primary-600 mt-1">{stat(summary?.revenue, fmt)}</p>
        </div>
      </section>

      {/* Revenue this month — actual vs forecast (run-rate) vs target */}
      {forecast && (forecast.target > 0 || forecast.actual > 0) && (
        <section className="card mb-8" data-testid="dashboard-forecast">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">{t('dash.overview.revenueThisMonth', 'Revenue this month')}</h2>
            <span className="text-xs text-text-muted">{forecast.period}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcActual', 'Actual so far')}</p><p className="text-xl font-semibold text-green-600">{fmt(forecast.actual)}</p></div>
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcForecast', 'Forecast (month-end)')}</p><p className="text-xl font-semibold text-primary-600">{fmt(forecast.projected)}</p></div>
            <div><p className="text-xs text-text-muted">{t('dash.overview.fcTarget', 'Target')}</p><p className="text-xl font-semibold">{forecast.target > 0 ? fmt(forecast.target) : '—'}</p></div>
            <div>
              <p className="text-xs text-text-muted">{t('dash.overview.fcAttainment', 'Projected attainment')}</p>
              <p className={`text-xl font-semibold ${forecast.projectedAttainmentPct == null ? '' : forecast.projectedAttainmentPct >= 100 ? 'text-green-600' : 'text-amber-600'}`}>{forecast.projectedAttainmentPct != null ? `${forecast.projectedAttainmentPct}%` : '—'}</p>
            </div>
          </div>
          {forecast.target > 0 && (
            <div className="mt-3 h-2 rounded-full bg-surface-sunken overflow-hidden">
              <div className="h-full bg-primary-500" style={{ width: `${Math.min(100, Math.round((forecast.actual / forecast.target) * 100))}%` }} />
            </div>
          )}
        </section>
      )}

      {/* Action Proposals */}
      <div className="mb-8">
        {tenantId && <ProposalsWidget tenantId={tenantId} />}
      </div>

      {/* Quick Access */}
      <section data-testid="dashboard-sections">
        <h2 className="section-title mb-4">{t('dash.overview.quickAccess', 'Quick Access')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="dashboard-section-links">
          {[
            { href: '/dashboard/services', label: t('dash.overview.manageServices', 'Manage Services'), icon: ShowerHead },
            { href: '/dashboard/memberships', label: t('dash.overview.membershipPlans', 'Membership Plans'), icon: CreditCard },
            { href: '/dashboard/reports', label: t('dash.overview.viewReports', 'View Reports'), icon: TrendingUp },
            { href: '/dashboard/settings', label: t('dash.overview.settings', 'Settings'), icon: Settings },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 p-4 rounded-xl border border-border bg-surface-raised hover:bg-surface-sunken transition-colors"
            >
              <item.icon className="w-5 h-5 text-primary-600" />
              <span className="text-sm font-medium text-text-primary">{item.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
