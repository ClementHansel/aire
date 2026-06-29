'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface SummaryResponse {
  totalOrders: number;
  revenue: number;
  paidCount: number;
  cancelledCount: number;
  uniqueMembers: number;
  newMembers: number;
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
  byService: { serviceId: string; name: string; quantity: number; revenue: number }[];
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<SummaryResponse>(
        `/reports/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

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
            <label className="block text-xs font-medium text-text-secondary mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
          <button className="btn-primary" onClick={loadReport} disabled={loading}>
            {loading ? 'Loading…' : 'Generate Report'}
          </button>
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
        </>
      )}
    </div>
  );
}
