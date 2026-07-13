'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { Bot } from 'lucide-react';

interface SeriesPoint { period: string; revenue: number; orders: number }
interface ServiceRow { serviceId: string; name: string; quantity: number; revenue: number }
interface Summary {
  totalOrders: number; revenue: number; paidCount: number; cancelledCount: number;
  byBusinessUnit: Record<string, { revenue: number; count: number }>;
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
  byService: ServiceRow[];
}
interface OrderCard {
  id: string; orderNumber: string; customerName: string; customerPhone: string;
  status: string; total: number; createdAt: string; operatorName: string;
}

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.length === 0 ? <p className="text-sm text-text-muted italic">{t('dash.transactions.noData', 'No data.')}</p> : data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-text-muted truncate">{d.label}</span>
          <div className="flex-1 bg-surface-sunken rounded h-5 overflow-hidden">
            <div className="h-full bg-primary-500 rounded" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="w-28 text-right font-mono text-text-secondary">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function TransactionsPage() {
  const { t } = useI18n();
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo] = useState(today());
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [businessUnit, setBusinessUnit] = useState<'' | 'AIRE' | 'LEAD'>('');
  const [branch, setBranch] = useState(''); // '' = all branches (owner/admin only; RLS scopes others)
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [todayOnly, setTodayOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState<string[]>([]);
  const [detail, setDetail] = useState<OrderCard | null>(null);
  const [editing, setEditing] = useState<OrderCard | null>(null);

  const buQs = businessUnit ? `&businessUnit=${businessUnit}` : '';
  const branchQs = branch ? `&outletId=${branch}` : '';

  const loadAnalytics = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = `dateFrom=${dateFrom}&dateTo=${dateTo}${buQs}${branchQs}`;
      const [s, sum] = await Promise.all([
        api.get<SeriesPoint[]>(`/reports/revenue-series?${qs}&granularity=${granularity}`),
        api.get<Summary>(`/reports/summary?${qs}`),
      ]);
      setSeries(s); setSummary(sum);
      computeInsights(s, sum);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.transactions.failLoadAnalytics', 'Failed to load analytics')); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, granularity, buQs, branchQs]);

  const loadOrders = useCallback(async () => {
    try {
      const df = todayOnly ? today() : dateFrom;
      const dt = todayOnly ? today() : dateTo;
      const res = await api.get<{ orders: OrderCard[]; total: number }>(`/orders?dateFrom=${df}&dateTo=${dt}&page=${page}&pageSize=${pageSize}${branchQs}`);
      setOrders(res.orders); setTotal(res.total);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.transactions.failLoadOrders', 'Failed to load orders')); }
  }, [dateFrom, dateTo, page, pageSize, todayOnly, branchQs]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const computeInsights = (s: SeriesPoint[], sum: Summary) => {
    const out: string[] = [];
    const totalRev = s.reduce((a, b) => a + b.revenue, 0);
    if (s.length >= 2) {
      const half = Math.floor(s.length / 2);
      const first = s.slice(0, half).reduce((a, b) => a + b.revenue, 0);
      const second = s.slice(half).reduce((a, b) => a + b.revenue, 0);
      if (first > 0) {
        const delta = Math.round(((second - first) / first) * 100);
        out.push(`${t('dash.transactions.revenue', 'Revenue')} ${delta >= 0 ? t('dash.transactions.grew', 'grew') : t('dash.transactions.declined', 'declined')} ${Math.abs(delta)}% ${t('dash.transactions.secondHalfVsFirst', 'in the second half of the range vs the first.')}`);
      }
    }
    const best = [...s].sort((a, b) => b.revenue - a.revenue)[0];
    if (best) out.push(`${t('dash.transactions.best', 'Best')} ${granularity}: ${best.period} ${t('dash.transactions.with', 'with')} ${fmt(best.revenue)} ${t('dash.transactions.across', 'across')} ${best.orders} ${t('dash.transactions.orders', 'orders')}.`);
    if (sum.byService[0]) out.push(`${t('dash.transactions.topProduct', 'Top product:')} ${sum.byService[0].name} (${sum.byService[0].quantity} ${t('dash.transactions.sold', 'sold')}, ${fmt(sum.byService[0].revenue)}).`);
    const aire = sum.byBusinessUnit?.AIRE?.revenue ?? 0; const lead = sum.byBusinessUnit?.LEAD?.revenue ?? 0;
    if (aire + lead > 0) out.push(`${t('dash.transactions.businessMix', 'Business mix:')} AIRE ${Math.round((aire / (aire + lead)) * 100)}% / LEAD ${Math.round((lead / (aire + lead)) * 100)}%.`);
    if (sum.cancelledCount > 0) out.push(`${sum.cancelledCount} ${t('dash.transactions.cancelledOrdersReview', 'cancelled order(s) in range — review for voids/errors.')}`);
    out.push(`${t('dash.transactions.totalRevenueInRange', 'Total revenue in range:')} ${fmt(totalRev)} ${t('dash.transactions.fromWord', 'from')} ${sum.paidCount} ${t('dash.transactions.paidOrdersDot', 'paid orders.')}`);
    setInsights(out);
  };

  const exportExcel = () => {
    const rows = orders.map((o) => `<tr><td>${o.orderNumber}</td><td>${new Date(o.createdAt).toLocaleString()}</td><td>${o.customerName}</td><td>${o.customerPhone}</td><td>${o.status}</td><td>${o.total}</td></tr>`).join('');
    const html = `<table border="1"><thead><tr><th>${t('dash.transactions.order', 'Order')}</th><th>${t('dash.transactions.date', 'Date')}</th><th>${t('dash.transactions.customer', 'Customer')}</th><th>${t('dash.transactions.phone', 'Phone')}</th><th>${t('dash.transactions.status', 'Status')}</th><th>${t('dash.transactions.total', 'Total')}</th></tr></thead><tbody>${rows}</tbody></table>`;
    const blob = new Blob([`\ufeff<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `transactions-${dateFrom}-to-${dateTo}.xls`; a.click(); URL.revokeObjectURL(a.href);
  };

  const exportPdf = () => {
    if (!summary) return;
    const insHtml = insights.map((i) => `<li>${i}</li>`).join('');
    const svcRows = summary.byService.map((s) => `<tr><td>${s.name}</td><td style="text-align:right">${s.quantity}</td><td style="text-align:right">${fmt(s.revenue)}</td></tr>`).join('');
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${t('dash.transactions.executiveReport', 'Executive Report')}</title><style>
      body{font-family:Geist,Arial,sans-serif;color:#0A0A0A;padding:40px;max-width:800px;margin:auto}
      h1{font-size:28px;letter-spacing:-0.02em} .muted{color:#6B7280} .kpis{display:flex;gap:16px;margin:24px 0}
      .kpi{flex:1;border:1px solid #E5E7EB;border-radius:12px;padding:16px} .kpi .v{font-size:24px;font-weight:700}
      table{width:100%;border-collapse:collapse;margin-top:12px} td,th{border-bottom:1px solid #E5E7EB;padding:8px;text-align:left;font-size:13px}
      .blue{color:#1652F0} ul{line-height:1.7}</style></head><body>
      <h1>AIRE — ${t('dash.transactions.executiveReport', 'Executive Report')}</h1>
      <p class="muted">${dateFrom} → ${dateTo}${businessUnit ? ` · ${businessUnit}` : ''}</p>
      <div class="kpis">
        <div class="kpi"><div class="muted">${t('dash.transactions.revenue', 'Revenue')}</div><div class="v blue">${fmt(summary.revenue)}</div></div>
        <div class="kpi"><div class="muted">${t('dash.transactions.paidOrders', 'Paid orders')}</div><div class="v">${summary.paidCount}</div></div>
        <div class="kpi"><div class="muted">AIRE</div><div class="v">${fmt(summary.byBusinessUnit?.AIRE?.revenue ?? 0)}</div></div>
        <div class="kpi"><div class="muted">LEAD</div><div class="v">${fmt(summary.byBusinessUnit?.LEAD?.revenue ?? 0)}</div></div>
      </div>
      <h3>${t('dash.transactions.insights', 'Insights')}</h3><ul>${insHtml}</ul>
      <h3>${t('dash.transactions.topProducts', 'Top products')}</h3><table><thead><tr><th>${t('dash.transactions.product', 'Product')}</th><th style="text-align:right">${t('dash.transactions.qty', 'Qty')}</th><th style="text-align:right">${t('dash.transactions.revenue', 'Revenue')}</th></tr></thead><tbody>${svcRows}</tbody></table>
      <p class="muted" style="margin-top:40px">${t('dash.transactions.generated', 'Generated')} ${new Date().toLocaleString()} · airin</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const del = async (o: OrderCard) => {
    if (!confirm(`${t('dash.transactions.deleteConfirm', 'Delete/void order')} ${o.orderNumber}?`)) return;
    try { await api.delete(`/orders/${o.id}`); await loadOrders(); await loadAnalytics(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.transactions.deleteFailed', 'Delete failed')); }
  };
  const saveEdit = async (patch: { customerName: string; customerPhone: string }) => {
    if (!editing) return;
    try { await api.patch(`/orders/${editing.id}`, patch); setEditing(null); await loadOrders(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.transactions.editFailed', 'Edit failed')); }
  };

  const revenueBars = series.map((p) => ({ label: p.period, value: p.revenue }));
  const productBars = (summary?.byService ?? []).map((s) => ({ label: s.name, value: s.revenue }));
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div data-testid="transactions-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.transactions.title', 'Transactions')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.transactions.subtitle', 'Revenue & product charts, transaction table, AI insights, and exports.')}</p>
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.from', 'From')}</label><input aria-label={t('dash.transactions.dateFrom', 'Date From')} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.to', 'To')}</label><input aria-label={t('dash.transactions.dateTo', 'Date To')} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.groupBy', 'Group by')}</label>
            <select aria-label={t('dash.transactions.granularity', 'Granularity')} value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')} className="input-field">
              <option value="day">{t('dash.transactions.daily', 'Daily')}</option><option value="week">{t('dash.transactions.weekly', 'Weekly')}</option><option value="month">{t('dash.transactions.monthly', 'Monthly')}</option>
            </select></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.businessUnit', 'Business unit')}</label>
            <select aria-label={t('dash.transactions.businessUnit', 'Business unit')} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value as '' | 'AIRE' | 'LEAD')} className="input-field">
              <option value="">{t('dash.transactions.all', 'All')}</option><option value="AIRE">AIRE</option><option value="LEAD">LEAD</option>
            </select></div>
          <BranchFilter value={branch} onChange={setBranch} label={t('dash.transactions.branch', 'Branch')} />
          <button className="btn-primary" onClick={() => { loadAnalytics(); loadOrders(); }} disabled={loading}>{loading ? t('dash.transactions.loading', 'Loading…') : t('dash.transactions.refresh', 'Refresh')}</button>
          <button className="btn-secondary" onClick={exportExcel}>{t('dash.transactions.exportExcel', 'Export Excel')}</button>
          <button className="btn-secondary" onClick={exportPdf}>{t('dash.transactions.executivePdf', 'Executive PDF')}</button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card"><p className="text-xs text-text-muted uppercase">{t('dash.transactions.revenue', 'Revenue')}</p><p className="text-2xl font-bold text-primary-600 mt-1">{fmt(summary.revenue)}</p></div>
          <div className="card"><p className="text-xs text-text-muted uppercase">{t('dash.transactions.paidOrders', 'Paid orders')}</p><p className="text-2xl font-bold mt-1">{summary.paidCount}</p></div>
          <div className="card"><p className="text-xs text-text-muted uppercase">AIRE</p><p className="text-2xl font-bold text-sky-600 mt-1">{fmt(summary.byBusinessUnit?.AIRE?.revenue ?? 0)}</p></div>
          <div className="card"><p className="text-xs text-text-muted uppercase">LEAD</p><p className="text-2xl font-bold text-violet-600 mt-1">{fmt(summary.byBusinessUnit?.LEAD?.revenue ?? 0)}</p></div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card"><h2 className="section-title mb-3">{t('dash.transactions.revenue', 'Revenue')} ({granularity})</h2><Bars data={revenueBars} /></div>
        <div className="card"><h2 className="section-title mb-3">{t('dash.transactions.salesPerProduct', 'Sales per product')}</h2><Bars data={productBars} /></div>
      </div>

      {/* AI Analysis */}
      <div className="card mb-6">
        <h2 className="section-title mb-3 flex items-center gap-2"><Bot className="w-4 h-4" />{t('dash.transactions.aiAnalysis', 'AI Analysis')}</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
          {insights.map((i, idx) => <li key={idx}>{i}</li>)}
        </ul>
      </div>

      {/* Transactions table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">{t('dash.transactions.title', 'Transactions')} ({total})</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary"><input type="checkbox" checked={todayOnly} onChange={(e) => { setTodayOnly(e.target.checked); setPage(1); }} /> {t('dash.transactions.todayOnly', 'Today only')}</label>
            <select aria-label={t('dash.transactions.pageSize', 'Page Size')} className="input-field py-1 text-xs" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </div>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.order', 'Order')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.customer', 'Customer')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.status', 'Status')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.total', 'Total')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.actions', 'Actions')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {orders.length === 0 ? <tr><td colSpan={5} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.transactions.noTransactions', 'No transactions.')}</td></tr> : orders.map((o) => (
              <tr key={o.id}>
                <td className="px-5 py-3 text-sm font-medium">{o.orderNumber}<div className="text-xs text-text-muted">{new Date(o.createdAt).toLocaleString()}</div></td>
                <td className="px-5 py-3 text-sm">{o.customerName}<div className="text-xs text-text-muted">{o.customerPhone}</div></td>
                <td className="px-5 py-3"><span className={`badge ${o.status === 'cancelled' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{o.status}</span></td>
                <td className="px-5 py-3 text-sm text-right font-mono">{fmt(o.total)}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setDetail(o)}>{t('dash.transactions.view', 'View')}</button>
                  <button className="btn-ghost text-xs" onClick={() => setEditing(o)}>{t('dash.transactions.edit', 'Edit')}</button>
                  {o.status !== 'cancelled' && <button className="btn-ghost text-xs text-red-600" onClick={() => del(o)}>{t('dash.transactions.delete', 'Delete')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-sm">
          <span className="text-text-muted">{t('dash.transactions.page', 'Page')} {page} / {pages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('dash.transactions.prev', 'Prev')}</button>
            <button className="btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('dash.transactions.next', 'Next')}</button>
          </div>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title mb-3">{t('dash.transactions.order', 'Order')} {detail.orderNumber}</h3>
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.customer', 'Customer')}</span><span>{detail.customerName}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.phone', 'Phone')}</span><span>{detail.customerPhone}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.operator', 'Operator')}</span><span>{detail.operatorName}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.status', 'Status')}</span><span className="capitalize">{detail.status}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.total', 'Total')}</span><span className="font-medium">{fmt(detail.total)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.date', 'Date')}</span><span>{new Date(detail.createdAt).toLocaleString()}</span></div>
            </div>
            <button className="btn-secondary w-full mt-4" onClick={() => setDetail(null)}>{t('dash.transactions.close', 'Close')}</button>
          </div>
        </div>
      )}

      {editing && (
        <EditModal order={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
      )}
    </div>
  );
}

function EditModal({ order, onClose, onSave }: { order: OrderCard; onClose: () => void; onSave: (p: { customerName: string; customerPhone: string }) => void }) {
  const { t } = useI18n();
  const [customerName, setName] = useState(order.customerName);
  const [customerPhone, setPhone] = useState(order.customerPhone);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{t('dash.transactions.edit', 'Edit')} {order.orderNumber}</h3>
        <div className="space-y-3">
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.transactions.customerName', 'Customer name')}</label><input aria-label={t('dash.transactions.customerName', 'Customer name')} className="input-field" value={customerName} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.transactions.phone', 'Phone')}</label><input aria-label={t('dash.transactions.customerPhone', 'Customer Phone')} className="input-field" value={customerPhone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button className="btn-secondary" onClick={onClose}>{t('dash.transactions.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={() => onSave({ customerName, customerPhone })}>{t('dash.transactions.save', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}
