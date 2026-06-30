'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { PosNav } from '@/components/pos/PosNav';

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

export default function SummaryPage() {
  const params = useParams();
  const agent = params.outletAgentId as string;
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = today();
      const result = await api.get<SummaryResponse>(`/reports/summary?dateFrom=${d}&dateTo=${d}`);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load summary');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    load();
  }, [load]);

  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const payments = data ? Object.entries(data.byPaymentMethod) : [];

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PosNav agent={agent} active="summary" title="Today's Summary" />

      <div className="p-5 flex-1">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
        {loading ? (
          <div className="card text-sm text-text-muted">Loading summary…</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="card"><p className="text-xs font-medium text-text-secondary uppercase">Orders</p><p className="text-2xl font-bold text-text-primary mt-1">{data.totalOrders}</p></div>
              <div className="card"><p className="text-xs font-medium text-text-secondary uppercase">Revenue</p><p className="text-2xl font-bold text-primary-600 mt-1">{fmt(data.revenue)}</p></div>
              <div className="card"><p className="text-xs font-medium text-text-secondary uppercase">Paid</p><p className="text-2xl font-bold text-success mt-1">{data.paidCount}</p></div>
              <div className="card"><p className="text-xs font-medium text-text-secondary uppercase">Cancelled</p><p className="text-2xl font-bold text-error mt-1">{data.cancelledCount}</p></div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="card p-0 overflow-hidden">
                <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">Payment Methods</h2></div>
                <div className="p-5">
                  {payments.length === 0 ? <p className="text-sm text-text-muted italic">No payments today.</p> : (
                    <table className="w-full text-sm"><tbody className="divide-y divide-border">
                      {payments.map(([m, v]) => (
                        <tr key={m}><td className="py-2 capitalize">{m.replace(/_/g, ' ')}</td><td className="py-2 text-right text-text-muted">{v.count}×</td><td className="py-2 text-right font-mono">{fmt(v.revenue)}</td></tr>
                      ))}
                    </tbody></table>
                  )}
                </div>
              </div>
              <div className="card p-0 overflow-hidden">
                <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">Top Services</h2></div>
                <div className="p-5">
                  {data.byService.length === 0 ? <p className="text-sm text-text-muted italic">No services sold today.</p> : (
                    <table className="w-full text-sm"><tbody className="divide-y divide-border">
                      {data.byService.map((s) => (
                        <tr key={s.serviceId}><td className="py-2">{s.name}</td><td className="py-2 text-right text-text-muted">{s.quantity}×</td><td className="py-2 text-right font-mono">{fmt(s.revenue)}</td></tr>
                      ))}
                    </tbody></table>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
