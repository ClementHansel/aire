'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import BranchFilter, { canFilterBranches } from '@/components/dashboard/BranchFilter';
import { getUser } from '@/lib/auth';
import { DocumentDesigner } from '@/components/dashboard/DocumentDesigner';
import { DailyOperationsReport, AgentPerformanceReportTable } from '@/components/dashboard/OperationalReports';

type ReportsTab = 'reports' | 'daily' | 'agent' | 'designer';

interface SummaryResponse {
  totalOrders: number;
  revenue: number;
  paidCount: number;
  cancelledCount: number;
  uniqueMembers: number;
  newMembers: number;
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
  byBusinessUnit: Record<string, { revenue: number; count: number }>;
  byService: { serviceId: string; name: string; quantity: number; revenue: number }[];
}

interface DailyRow { date: string; orders: number; revenue: number; paidOrders: number; }
interface ShiftRow { id: string; operator: string | null; status: string; openingFloat: number; totalSales: number | null; cashSales: number | null; counted: number | null; expected: number | null; variance: number | null; openedAt: string; closedAt: string | null; }

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<ReportsTab>('reports');
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [businessUnit, setBusinessUnit] = useState<'' | 'AIRE' | 'LEAD'>('');
  const [branch, setBranch] = useState(''); // '' = all branches (owner/admin only; RLS scopes others)
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Resolved in an effect, not during render: getUser() reads localStorage, which
  // is unavailable server-side and would desync the first client paint.
  const [userRole, setUserRole] = useState<string | undefined>(undefined);

  // Deep-link support: /dashboard/reports?tab=designer
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'designer' || q === 'reports' || q === 'daily' || q === 'agent') setTab(q);
    setUserRole(getUser()?.role);
  }, []);

  const loadReport = useCallback(async (overrides?: { from: string; to: string }) => {
    const from = overrides?.from ?? dateFrom;
    const to = overrides?.to ?? dateTo;
    setLoading(true);
    setError('');
    try {
      const qs = `dateFrom=${from}&dateTo=${to}${businessUnit ? `&businessUnit=${businessUnit}` : ''}${branch ? `&outletId=${branch}` : ''}`;
      const [summary, dailyRows, shiftRows] = await Promise.all([
        api.get<SummaryResponse>(`/reports/summary?${qs}`),
        api.get<DailyRow[]>(`/reports/daily-sales?${qs}`),
        api.get<ShiftRow[]>(`/reports/shifts?${qs}`),
      ]);
      setData(summary);
      setDaily(dailyRows);
      setShifts(shiftRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.reports.failLoad', 'Failed to load report'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, businessUnit, branch]);

  // Load on mount and re-run whenever a filter changes. Previously the report
  // only ever loaded on an explicit "Generate Report" click, so the page opened
  // empty and changing Business unit / Branch appeared to do nothing at all —
  // which is what AIRIN-130 was reported as. The Transactions page already
  // auto-applies; this makes Reports consistent with it. The Generate button
  // stays as an explicit refresh.
  //
  // An inverted date range is left to the server rather than guarded here: it
  // returns an empty range instead of an error, and the date inputs' min/max
  // already stop the pickers from producing one.
  useEffect(() => {
    if (tab !== 'reports') return;
    void loadReport();
  }, [loadReport, tab]);

  const exportCsv = (scope: 'orders' | 'daily') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('aire_access_token') : null;
    const base = process.env.NEXT_PUBLIC_API_URL || '/api';
    const url = `${base}/reports/export?dateFrom=${dateFrom}&dateTo=${dateTo}&scope=${scope}${businessUnit ? `&businessUnit=${businessUnit}` : ''}${branch ? `&outletId=${branch}` : ''}`;
    // Fetch with auth then trigger a download (export route requires the bearer token).
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${scope === 'daily' ? 'daily-sales' : 'orders'}-${dateFrom}-to-${dateTo}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => setError(t('dash.reports.exportFailed', 'Export failed')));
  };

  const [exportingPdf, setExportingPdf] = useState(false);
  const exportPdf = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('aire_access_token') : null;
    const base = process.env.NEXT_PUBLIC_API_URL || '/api';
    const url = `${base}/reports/export?format=pdf&dateFrom=${dateFrom}&dateTo=${dateTo}${businessUnit ? `&businessUnit=${businessUnit}` : ''}${branch ? `&outletId=${branch}` : ''}`;
    setExportingPdf(true);
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('PDF export failed');
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `AIRE-report-${dateFrom}-to-${dateTo}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => setError(t('dash.reports.pdfExportFailed', 'PDF export failed')))
      .finally(() => setExportingPdf(false));
  };

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const paymentMethods = data ? Object.entries(data.byPaymentMethod) : [];
  // The filter bar is shared by every data tab, so the query string is built
  // once here rather than per report.
  const qs = `dateFrom=${dateFrom}&dateTo=${dateTo}${businessUnit ? `&businessUnit=${businessUnit}` : ''}${branch ? `&outletId=${branch}` : ''}`;

  return (
    <div data-testid="reports-page">
      <h1 className="text-2xl font-bold text-text-primary mb-4" data-testid="reports-title">{t('dash.reports.title', 'Reports')}</h1>

      <div className="flex gap-1 border-b border-border mb-6">
        {([
          { key: 'reports' as const, label: t('dash.reports.tabReports', 'Reports') },
          { key: 'daily' as const, label: t('dash.reports.tabDaily', 'Daily operations') },
          { key: 'agent' as const, label: t('dash.reports.tabAgent', 'Sales per agent') },
          { key: 'designer' as const, label: t('dash.reports.tabDesigner', 'Report Designer') },
        ]).map((tb) => (
          <button
            key={tb.key}
            data-testid={`reports-tab-${tb.key}`}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === tb.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'designer' ? (
        <DocumentDesigner kind="report" showHeading={false} />
      ) : (
      <>
      <p className="mb-6 text-sm text-text-secondary">{t('dash.reports.subtitle', 'Consolidated business metrics and performance data.')}</p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="report-date-from" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.reports.from', 'From')}</label>
            <input id="report-date-from" aria-label={t('dash.reports.fromDate', 'From date')} type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label htmlFor="report-date-to" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.reports.to', 'To')}</label>
            <input id="report-date-to" aria-label={t('dash.reports.toDate', 'To date')} type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const t0 = today();
              setDateFrom(t0);
              setDateTo(t0);
              loadReport({ from: t0, to: t0 });
            }}
          >
            {t('dash.reports.today', 'Today')}
          </button>
          <div>
            <label htmlFor="report-business-unit" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.reports.businessUnit', 'Business unit')}</label>
            <select id="report-business-unit" aria-label={t('dash.reports.businessUnit', 'Business unit')} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value as '' | 'AIRE' | 'LEAD')} className="input-field">
              <option value="">{t('dash.reports.allUnits', 'All units')}</option>
              <option value="AIRE">{t('dash.reports.aireCarWash', 'AIRE · Car Wash')}</option>
              <option value="LEAD">{t('dash.reports.leadDetailing', 'LEAD · Detailing')}</option>
            </select>
          </div>
          {/* BranchFilter renders nothing for outlet-scoped roles (RLS/scope
              already narrows their data). Say so, rather than leaving a gap where
              a control should be — "Branch filter tidak berfungsi" is literally
              true for such a user if the control is simply absent (AIRIN-130). */}
          <BranchFilter value={branch} onChange={setBranch} label={t('dash.reports.branch', 'Branch')} />
          {/* Only once the role is known — rendering on the initial `undefined`
              would flash this note at an owner before their dropdown appears. */}
          {userRole !== undefined && !canFilterBranches(userRole) && (
            <div>
              <span className="block text-xs font-medium text-text-secondary mb-1">{t('dash.reports.branch', 'Branch')}</span>
              <p className="text-sm text-text-muted py-2" data-testid="reports-branch-scope-note">
                {t('dash.reports.branchScopedNote', 'Your assigned branch only')}
              </p>
            </div>
          )}
          <button className="btn-primary" onClick={() => loadReport()} disabled={loading}>
            {loading ? t('dash.reports.loading', 'Loading…') : t('dash.reports.generateReport', 'Generate Report')}
          </button>
          {data && tab === 'reports' && (
            <>
              <button type="button" className="btn-primary" onClick={exportPdf} disabled={exportingPdf}>
                {exportingPdf ? t('dash.reports.preparingPdf', 'Preparing PDF…') : `⭳ ${t('dash.reports.exportPdf', 'Export PDF')}`}
              </button>
              <button type="button" className="btn-secondary" onClick={() => exportCsv('daily')}>{t('dash.reports.exportDailyCsv', 'Export daily CSV')}</button>
              <button type="button" className="btn-secondary" onClick={() => exportCsv('orders')}>{t('dash.reports.exportOrdersCsv', 'Export orders CSV')}</button>
            </>
          )}
        </div>
      </div>

      {tab === 'daily' ? (
        <DailyOperationsReport qs={qs} dateFrom={dateFrom} dateTo={dateTo} />
      ) : tab === 'agent' ? (
        <AgentPerformanceReportTable qs={qs} dateFrom={dateFrom} dateTo={dateTo} />
      ) : !data ? (
        <div className="card text-sm text-text-muted">{t('dash.reports.selectPrompt', 'Select a date range and click "Generate Report" to view metrics.')}</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.reports.totalOrders', 'Total Orders')}</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{data.totalOrders}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.reports.revenue', 'Revenue')}</p>
              <p className="text-2xl font-bold text-primary-600 mt-1">{fmt(data.revenue)}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.reports.paid', 'Paid')}</p>
              <p className="text-2xl font-bold text-success mt-1">{data.paidCount}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.reports.cancelled', 'Cancelled')}</p>
              <p className="text-2xl font-bold text-error mt-1">{data.cancelledCount}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.reports.uniqueMembers', 'Unique Members')}</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{data.uniqueMembers}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.reports.newMembers', 'New Members')}</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{data.newMembers}</p>
            </div>
          </div>

          {/* Business unit P&L split. When a unit is selected, show only that
              unit — a two-card "split" with one card zeroed is as confusing as
              the old behaviour of showing both at full revenue (AIRIN-130). */}
          <div className={`grid grid-cols-1 gap-4 mb-6 ${businessUnit ? '' : 'sm:grid-cols-2'}`}>
            {(businessUnit ? [businessUnit] as const : ['AIRE', 'LEAD'] as const).map((bu) => {
              const v = data.byBusinessUnit?.[bu] ?? { revenue: 0, count: 0 };
              return (
                <div key={bu} className="card">
                  <div className="flex items-center justify-between">
                    <span className={`badge ${bu === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{bu === 'AIRE' ? t('dash.reports.aireCarWash', 'AIRE · Car Wash') : t('dash.reports.leadDetailing', 'LEAD · Detailing')}</span>
                    <span className="text-xs text-text-muted">{v.count} {t('dash.reports.orders', 'orders')}</span>
                  </div>
                  <p className="text-2xl font-bold text-text-primary mt-2">{fmt(v.revenue)}</p>
                </div>
              );
            })}
          </div>

          {/* Tables */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">{t('dash.reports.paymentMethods', 'Payment Methods')}</h2></div>
              <div className="p-5">
                {paymentMethods.length === 0 ? (
                  <p className="text-sm text-text-muted italic">{t('dash.reports.noDataPeriod', 'No data for selected period.')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">{t('dash.reports.method', 'Method')}</th><th className="pb-2 text-right">{t('dash.reports.count', 'Count')}</th><th className="pb-2 text-right">{t('dash.reports.revenue', 'Revenue')}</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {paymentMethods.map(([method, v]) => (
                        <tr key={method}><td className="py-2 capitalize">{method.replace(/_/g, ' ')}</td><td className="py-2 text-right">{v.count}</td><td className="py-2 text-right font-mono">{fmt(v.revenue)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">{t('dash.reports.topServices', 'Top Services')}</h2></div>
              <div className="p-5">
                {data.byService.length === 0 ? (
                  <p className="text-sm text-text-muted italic">{t('dash.reports.noDataPeriod', 'No data for selected period.')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">{t('dash.reports.service', 'Service')}</th><th className="pb-2 text-right">{t('dash.reports.qty', 'Qty')}</th><th className="pb-2 text-right">{t('dash.reports.revenue', 'Revenue')}</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {data.byService.map((s) => (
                        <tr key={s.serviceId}><td className="py-2">{s.name}</td><td className="py-2 text-right">{s.quantity}</td><td className="py-2 text-right font-mono">{fmt(s.revenue)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Day-by-day sales */}
          <div className="card p-0 overflow-hidden mt-6">
            <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">{t('dash.reports.dailySales', 'Daily Sales')}</h2></div>
            <div className="p-5 overflow-auto">
              {daily.length === 0 ? <p className="text-sm text-text-muted italic">{t('dash.reports.noSalesPeriod', 'No sales in this period.')}</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">{t('dash.reports.date', 'Date')}</th><th className="pb-2 text-right">{t('dash.reports.ordersCol', 'Orders')}</th><th className="pb-2 text-right">{t('dash.reports.paid', 'Paid')}</th><th className="pb-2 text-right">{t('dash.reports.revenue', 'Revenue')}</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {daily.map((d) => (
                      <tr key={d.date}><td className="py-2">{d.date}</td><td className="py-2 text-right">{d.orders}</td><td className="py-2 text-right">{d.paidOrders}</td><td className="py-2 text-right font-mono">{fmt(d.revenue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Shift-by-shift */}
          <div className="card p-0 overflow-hidden mt-6">
            <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">{t('dash.reports.shiftsTitle', 'Shifts (register sessions)')}</h2></div>
            <div className="p-5 overflow-auto">
              {shifts.length === 0 ? <p className="text-sm text-text-muted italic">{t('dash.reports.noShiftsPeriod', 'No shifts in this period.')}</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">{t('dash.reports.operator', 'Operator')}</th><th className="pb-2">{t('dash.reports.opened', 'Opened')}</th><th className="pb-2">{t('dash.reports.status', 'Status')}</th><th className="pb-2 text-right">{t('dash.reports.sales', 'Sales')}</th><th className="pb-2 text-right">{t('dash.reports.expected', 'Expected')}</th><th className="pb-2 text-right">{t('dash.reports.counted', 'Counted')}</th><th className="pb-2 text-right">{t('dash.reports.variance', 'Variance')}</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {shifts.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2">{s.operator ?? '—'}</td>
                        <td className="py-2 text-text-muted">{new Date(s.openedAt).toLocaleString()}</td>
                        <td className="py-2 capitalize">{s.status}</td>
                        <td className="py-2 text-right font-mono">{s.totalSales != null ? fmt(s.totalSales) : '—'}</td>
                        <td className="py-2 text-right font-mono">{s.expected != null ? fmt(s.expected) : '—'}</td>
                        <td className="py-2 text-right font-mono">{s.counted != null ? fmt(s.counted) : '—'}</td>
                        <td className={`py-2 text-right font-mono ${s.variance != null && s.variance !== 0 ? (s.variance < 0 ? 'text-error' : 'text-success') : ''}`}>{s.variance != null ? fmt(s.variance) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
