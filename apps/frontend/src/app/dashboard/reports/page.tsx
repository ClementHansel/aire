'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import BranchFilter from '@/components/dashboard/BranchFilter';

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
interface ShiftRow { id: string; operator: string | null; status: string; openingFloat: number; totalSales: number | null; cashSales: number | null; counted: number | null; expected: number | null; variance: number | null; orders: number | null; openedAt: string; closedAt: string | null; }

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [businessUnit, setBusinessUnit] = useState<'' | 'AIRE' | 'LEAD'>('');
  const [branch, setBranch] = useState(''); // '' = all branches (owner/admin only; RLS scopes others)
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = `dateFrom=${dateFrom}&dateTo=${dateTo}${businessUnit ? `&businessUnit=${businessUnit}` : ''}${branch ? `&outletId=${branch}` : ''}`;
      const [summary, dailyRows, shiftRows] = await Promise.all([
        api.get<SummaryResponse>(`/reports/summary?${qs}`),
        api.get<DailyRow[]>(`/reports/daily-sales?${qs}`),
        api.get<ShiftRow[]>(`/reports/shifts?${qs}`),
      ]);
      setData(summary);
      setDaily(dailyRows);
      setShifts(shiftRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, businessUnit, branch]);

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
      .catch(() => setError('Export failed'));
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
      .catch(() => setError('PDF export failed'))
      .finally(() => setExportingPdf(false));
  };

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const paymentMethods = data ? Object.entries(data.byPaymentMethod) : [];

  return (
    <div data-testid="reports-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="reports-title">Reports</h1>
          <p className="mt-1 text-sm text-text-secondary">Consolidated business metrics and performance data.</p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="report-date-from" className="block text-xs font-medium text-text-secondary mb-1">From</label>
            <input id="report-date-from" aria-label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label htmlFor="report-date-to" className="block text-xs font-medium text-text-secondary mb-1">To</label>
            <input id="report-date-to" aria-label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
          <div>
            <label htmlFor="report-business-unit" className="block text-xs font-medium text-text-secondary mb-1">Business unit</label>
            <select id="report-business-unit" aria-label="Business unit" value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value as '' | 'AIRE' | 'LEAD')} className="input-field">
              <option value="">All units</option>
              <option value="AIRE">AIRE · Car Wash</option>
              <option value="LEAD">LEAD · Detailing</option>
            </select>
          </div>
          <BranchFilter value={branch} onChange={setBranch} label="Branch" />
          <button className="btn-primary" onClick={loadReport} disabled={loading}>
            {loading ? 'Loading…' : 'Generate Report'}
          </button>
          {data && (
            <>
              <button type="button" className="btn-primary" onClick={exportPdf} disabled={exportingPdf}>
                {exportingPdf ? 'Preparing PDF…' : '⭳ Export PDF'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => exportCsv('daily')}>Export daily CSV</button>
              <button type="button" className="btn-secondary" onClick={() => exportCsv('orders')}>Export orders CSV</button>
            </>
          )}
        </div>
      </div>

      {!data ? (
        <div className="card text-sm text-text-muted">Select a date range and click &quot;Generate Report&quot; to view metrics.</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Total Orders</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{data.totalOrders}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Revenue</p>
              <p className="text-2xl font-bold text-primary-600 mt-1">{fmt(data.revenue)}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Paid</p>
              <p className="text-2xl font-bold text-success mt-1">{data.paidCount}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Cancelled</p>
              <p className="text-2xl font-bold text-error mt-1">{data.cancelledCount}</p>
            </div>
          </div>

          {/* Business unit P&L split */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {(['AIRE', 'LEAD'] as const).map((bu) => {
              const v = data.byBusinessUnit?.[bu] ?? { revenue: 0, count: 0 };
              return (
                <div key={bu} className="card">
                  <div className="flex items-center justify-between">
                    <span className={`badge ${bu === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{bu === 'AIRE' ? 'AIRE · Car Wash' : 'LEAD · Detailing'}</span>
                    <span className="text-xs text-text-muted">{v.count} orders</span>
                  </div>
                  <p className="text-2xl font-bold text-text-primary mt-2">{fmt(v.revenue)}</p>
                </div>
              );
            })}
          </div>

          {/* Tables */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">Payment Methods</h2></div>
              <div className="p-5">
                {paymentMethods.length === 0 ? (
                  <p className="text-sm text-text-muted italic">No data for selected period.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">Method</th><th className="pb-2 text-right">Count</th><th className="pb-2 text-right">Revenue</th></tr></thead>
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
              <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">Top Services</h2></div>
              <div className="p-5">
                {data.byService.length === 0 ? (
                  <p className="text-sm text-text-muted italic">No data for selected period.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">Service</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Revenue</th></tr></thead>
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
            <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">Daily Sales</h2></div>
            <div className="p-5 overflow-auto">
              {daily.length === 0 ? <p className="text-sm text-text-muted italic">No sales in this period.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">Date</th><th className="pb-2 text-right">Orders</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Revenue</th></tr></thead>
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
            <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold text-text-primary">Shifts (register sessions)</h2></div>
            <div className="p-5 overflow-auto">
              {shifts.length === 0 ? <p className="text-sm text-text-muted italic">No shifts in this period.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-text-secondary uppercase"><th className="pb-2">Operator</th><th className="pb-2">Opened</th><th className="pb-2">Status</th><th className="pb-2 text-right">Sales</th><th className="pb-2 text-right">Expected</th><th className="pb-2 text-right">Counted</th><th className="pb-2 text-right">Variance</th></tr></thead>
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
    </div>
  );
}
