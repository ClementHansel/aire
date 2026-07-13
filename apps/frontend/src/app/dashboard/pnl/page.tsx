'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, StatCard, Panel, ErrorBanner,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls,
  fmtIDR, fmtPct, Spinner,
} from '@/components/dashboard/ui';

interface Pnl {
  dateFrom: string; dateTo: string;
  revenue: number; cogs: number; grossProfit: number; grossMarginPct: number; expenses: number; netProfit: number;
}
interface ProductMargin {
  products: { serviceId: string; name: string; qty: number; revenue: number; cogs: number; margin: number; marginPct: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function PnlPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [margin, setMargin] = useState<ProductMargin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [p, m] = await Promise.all([
        api.get<Pnl>(`/cogs/pnl?dateFrom=${from}&dateTo=${to}`),
        api.get<ProductMargin>(`/cogs/product-margin?dateFrom=${from}&dateTo=${to}`),
      ]);
      setPnl(p); setMargin(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.pnl.loadError', 'Failed to load P&L'));
    } finally { setLoading(false); }
  }, [from, to, t]);
  useEffect(() => { load(); }, [load]);

  const preset = (label: string, f: string, tt: string) => {
    const active = from === f && to === tt;
    return (
      <button key={label} onClick={() => { setFrom(f); setTo(tt); }}
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-primary-500 text-white' : 'border border-border bg-surface-raised text-text-secondary hover:text-text-primary'}`}>
        {label}
      </button>
    );
  };

  const netMargin = pnl && pnl.revenue > 0 ? (pnl.netProfit / pnl.revenue) * 100 : null;
  const products = margin?.products ?? [];

  // Simple statement rows.
  const rows = pnl ? [
    { label: t('dash.pnl.revenue', 'Revenue'), value: pnl.revenue, tone: 'text-text-primary', strong: true },
    { label: `− ${t('dash.pnl.cogs', 'Cost of goods sold (COGS)')}`, value: -pnl.cogs, tone: 'text-rose-600' },
    { label: t('dash.pnl.grossProfit', 'Gross profit'), value: pnl.grossProfit, tone: 'text-green-600', strong: true, sep: true },
    { label: `− ${t('dash.pnl.expenses', 'Operating expenses')}`, value: -pnl.expenses, tone: 'text-rose-600' },
    { label: t('dash.pnl.netProfit', 'Net profit'), value: pnl.netProfit, tone: pnl.netProfit >= 0 ? 'text-green-600' : 'text-rose-600', strong: true, sep: true },
  ] : [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.pnl.title', 'Profit & Loss')}
        subtitle={t('dash.pnl.subtitle', 'Your financial statement for the period: revenue less COGS and operating expenses, with per-product profitability.')}
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Range + presets */}
      <div className="card flex flex-wrap items-end gap-4">
        <div><label className="mb-1 block text-xs font-medium text-text-secondary">{t('dash.pnl.from', 'From')}</label><input type="date" className="input-field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-medium text-text-secondary">{t('dash.pnl.to', 'To')}</label><input type="date" className="input-field" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-wrap items-center gap-2">
          {preset(t('dash.pnl.p7', '7d'), daysAgo(7), today())}
          {preset(t('dash.pnl.p30', '30d'), daysAgo(30), today())}
          {preset(t('dash.pnl.p90', '90d'), daysAgo(90), today())}
          {preset(t('dash.pnl.pMonth', 'This month'), monthStart(), today())}
        </div>
        <button className="btn-primary ml-auto" onClick={load} disabled={loading}>{loading ? <Spinner /> : t('dash.pnl.refresh', 'Refresh')}</button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard loading={loading} label={t('dash.pnl.revenue', 'Revenue')} value={fmtIDR(pnl?.revenue)} />
        <StatCard loading={loading} label={t('dash.pnl.grossMargin', 'Gross margin')} value={fmtPct(pnl?.grossMarginPct)} tone="positive" />
        <StatCard loading={loading} label={t('dash.pnl.netProfit', 'Net profit')} value={fmtIDR(pnl?.netProfit)} tone={(pnl?.netProfit ?? 0) >= 0 ? 'positive' : 'negative'} />
        <StatCard loading={loading} label={t('dash.pnl.netMargin', 'Net margin')} value={fmtPct(netMargin)} tone={netMargin == null ? 'default' : netMargin >= 0 ? 'positive' : 'negative'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Statement */}
        <Panel title={t('dash.pnl.statement', 'Income statement')}>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-surface-sunken" />)}</div>
          ) : !pnl ? (
            <p className="py-6 text-center text-sm text-text-muted">{t('dash.pnl.noData', 'No data.')}</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className={`flex items-center justify-between ${r.sep ? 'border-t border-border pt-2' : ''}`}>
                  <span className={`text-sm ${r.strong ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>{r.label}</span>
                  <span className={`tabular-nums ${r.strong ? 'text-base font-bold' : 'text-sm'} ${r.tone}`}>{fmtIDR(r.value)}</span>
                </div>
              ))}
              <p className="pt-1 text-xs text-text-muted">{pnl.dateFrom} → {pnl.dateTo}</p>
            </div>
          )}
        </Panel>

        {/* Margin summary bar */}
        <Panel title={t('dash.pnl.marginBreakdown', 'Where the money goes')}>
          {loading || !pnl ? (
            <div className="h-40 animate-pulse rounded bg-surface-sunken" />
          ) : pnl.revenue <= 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">{t('dash.pnl.noRevenue', 'No revenue in range.')}</p>
          ) : (
            <div className="space-y-4">
              {[
                { label: t('dash.pnl.cogs', 'COGS'), val: pnl.cogs, color: 'bg-rose-400' },
                { label: t('dash.pnl.expenses', 'Operating expenses'), val: pnl.expenses, color: 'bg-amber-400' },
                { label: t('dash.pnl.netProfit', 'Net profit'), val: Math.max(0, pnl.netProfit), color: 'bg-green-500' },
              ].map((seg) => (
                <div key={seg.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-text-secondary">{seg.label}</span>
                    <span className="tabular-nums text-text-primary">{fmtIDR(seg.val)} · {fmtPct((seg.val / pnl.revenue) * 100)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div className={`h-full rounded-full ${seg.color}`} style={{ width: `${Math.min(100, (seg.val / pnl.revenue) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Product profitability */}
      <Panel
        title={t('dash.pnl.productMargin', 'Product profitability')}
        description={t('dash.pnl.productMarginDesc', 'Ranked by revenue — COGS is the cost frozen at sale time')}
        bodyClassName="p-0"
      >
        {loading ? <TableSkeleton rows={6} cols={6} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.pnl.product', 'Product')}</th>
                <th className={`${thCls} text-right`}>{t('dash.pnl.qty', 'Qty')}</th>
                <th className={`${thCls} text-right`}>{t('dash.pnl.revenue', 'Revenue')}</th>
                <th className={`${thCls} text-right`}>{t('dash.pnl.cogsShort', 'COGS')}</th>
                <th className={`${thCls} text-right`}>{t('dash.pnl.margin', 'Margin')}</th>
                <th className={`${thCls} text-right`}>{t('dash.pnl.marginPct', 'Margin %')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.length === 0 ? (
                <EmptyRow colSpan={6}>{t('dash.pnl.noSales', 'No sales in the selected range.')}</EmptyRow>
              ) : products.map((p) => (
                <tr key={p.serviceId} className="hover:bg-surface-sunken/40">
                  <td className={`${tdCls} font-medium`}>{p.name}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{p.qty}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{fmtIDR(p.revenue)}</td>
                  <td className={`${tdCls} text-right tabular-nums text-text-secondary`}>{fmtIDR(p.cogs)}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(p.margin)}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums ${p.marginPct >= 0 ? 'text-green-600' : 'text-rose-600'}`}>{fmtPct(p.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
