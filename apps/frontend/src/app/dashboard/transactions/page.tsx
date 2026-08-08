'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { fmtDate } from '@/lib/dates';
import { memberBadge } from '@/lib/memberStatus';
import { Bot } from 'lucide-react';

interface SeriesPoint { period: string; revenue: number; orders: number }
/** One row of the product mix. `kind` distinguishes a service from a membership
 *  plan / voucher pack — all three are ordinary order lines server-side now. */
interface ServiceRow { serviceId: string; name: string; kind?: 'service' | 'membership_plan' | 'voucher_pack'; quantity: number; revenue: number }
interface Summary {
  totalOrders: number; revenue: number; paidCount: number; cancelledCount: number;
  byBusinessUnit: Record<string, { revenue: number; count: number }>;
  byPaymentMethod: Record<string, { revenue: number; count: number }>;
  byService: ServiceRow[];
}
interface OrderCardItem {
  serviceId?: string | null; serviceName: string; quantity: number; subtotal: number; itemType?: string | null;
  isMemberPricing?: boolean; memberDiscountType?: string | null; memberDiscountValue?: number | null;
}
/** Why money moved: a promotion, a redeemed voucher, or a campaign this sale earned. */
interface OrderDiscountSource {
  kind: 'promo' | 'voucher' | 'campaign'; label: string; amount: number | null;
  coversServiceId?: string | null; viaCampaign?: string | null;
}
interface OrderCard {
  id: string; orderNumber: string; customerName: string; customerPhone: string;
  status: string; total: number; createdAt: string; operatorName: string;
  paymentMethod: string | null; isMember: boolean;
  items?: OrderCardItem[];
  discountSources?: OrderDiscountSource[];
}
/** Settlement methods offered by the POS — same set the payment modal writes. */
const PAYMENT_METHODS = ['cash', 'qris_dynamic', 'qris_static', 'edc', 'cc', 'transfer'] as const;
type MemberFilter = '' | 'member' | 'non_member';
// Membership row from GET /memberships/manage — plan sales (AIRIN-133).
// purchaseDate is the linked fee order's created_at (null only for the rare
// membership with no order_id); price is joined in from GET /membership-plans
// by name. Both endpoints accept dateFrom/dateTo/outletId server-side now.
interface MembershipSaleRow {
  id: string; customerName: string; planName: string; startDate: string; purchaseDate: string | null;
  status: string; displayStatus: string;
}
interface PlanPrice { id: string; name: string; price: number }
// Voucher book row from GET /voucher-tickets/books — a "pack" sale of N
// shareable ticket codes at one unit price.
interface VoucherBookRow {
  id: string; buyerName: string; buyerPhone: string; quantity: number;
  benefitType: string; benefitName: string | null; unitPrice: number;
  outletId: string; outletName: string; redeemed: number; createdAt: string;
}
/** One line of the product-mix chart: a service, a membership plan, or a voucher pack. */
type ProductKind = 'service' | 'membership' | 'voucher';
interface ProductRow { name: string; quantity: number; revenue: number; kind: ProductKind }

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// Bar fill per product kind, so a membership/voucher line is readable at a
// glance against the ordinary service lines it now shares the chart with.
const KIND_BAR: Record<ProductKind, string> = {
  service: 'bg-primary-500',
  membership: 'bg-violet-500',
  voucher: 'bg-amber-500',
};

interface BarDatum { label: string; value: number; kind?: ProductKind; quantity?: number }

function Bars({ data }: { data: BarDatum[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.length === 0 ? <p className="text-sm text-text-muted italic">{t('dash.transactions.noData', 'No data.')}</p> : data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs" title={d.quantity != null ? `${d.label} — ${d.quantity} ${t('dash.transactions.sold', 'sold')}` : d.label}>
          <span className="w-32 shrink-0 text-text-muted truncate">{d.label}</span>
          <div className="flex-1 bg-surface-sunken rounded h-5 overflow-hidden">
            <div className={`h-full rounded ${KIND_BAR[d.kind ?? 'service']}`} style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="w-28 text-right font-mono text-text-secondary">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Toggle button for the transaction-table quick filters. */
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-primary-500 border-primary-500 text-white'
          : 'bg-surface border-border text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
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
  // Transaction-table filters (server-side, so `total` and the pager stay honest).
  const [paymentMethod, setPaymentMethod] = useState('');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState<string[]>([]);
  const [detail, setDetail] = useState<OrderCard | null>(null);
  const [editing, setEditing] = useState<OrderCard | null>(null);
  const [membershipSales, setMembershipSales] = useState<MembershipSaleRow[]>([]);
  const [plans, setPlans] = useState<PlanPrice[]>([]);
  const [voucherBooks, setVoucherBooks] = useState<VoucherBookRow[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);

  const buQs = businessUnit ? `&businessUnit=${businessUnit}` : '';
  const branchQs = branch ? `&outletId=${branch}` : '';

  // An inverted range yields an empty result set that looks identical to "no
  // transactions in this period", so guard it instead of querying (AIRIN-132).
  // ISO YYYY-MM-DD compares correctly as a string.
  const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const rangeError = rangeInvalid
    ? t('dash.transactions.invalidRange', 'Start date is after end date — adjust the range to see results.')
    : '';

  const loadAnalytics = useCallback(async () => {
    if (rangeInvalid) { setSeries([]); setSummary(null); setInsights([]); setLoading(false); return; }
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
  }, [dateFrom, dateTo, granularity, buQs, branchQs, rangeInvalid]);

  const loadOrders = useCallback(async () => {
    if (rangeInvalid) { setOrders([]); setTotal(0); return; }
    try {
      const df = todayOnly ? today() : dateFrom;
      const dt = todayOnly ? today() : dateTo;
      const pmQs = paymentMethod ? `&paymentMethod=${paymentMethod}` : '';
      const memberQs = memberFilter ? `&member=${memberFilter}` : '';
      const res = await api.get<{ orders: OrderCard[]; total: number }>(`/orders?dateFrom=${df}&dateTo=${dt}&page=${page}&pageSize=${pageSize}${branchQs}${pmQs}${memberQs}`);
      setOrders(res.orders); setTotal(res.total);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.transactions.failLoadOrders', 'Failed to load orders')); }
  }, [dateFrom, dateTo, page, pageSize, todayOnly, branchQs, rangeInvalid, paymentMethod, memberFilter]);

  // Membership-plan and voucher-pack sales (AIRIN-133). Both endpoints now
  // accept dateFrom/dateTo/outletId server-side (dates filter by purchase
  // date — the linked fee order's created_at for memberships, the book's own
  // created_at for voucher books; branch scoping goes through ScopeService
  // exactly like /reports and /orders), so this page's date range and
  // BranchFilter apply the same way they do to every other section.
  const loadPurchases = useCallback(async () => {
    if (rangeInvalid) { setMembershipSales([]); setVoucherBooks([]); return; }
    setPurchasesLoading(true);
    try {
      const qs = `dateFrom=${dateFrom}&dateTo=${dateTo}${branchQs}`;
      const [memberships, planList, books] = await Promise.all([
        api.get<MembershipSaleRow[]>(`/memberships/manage?${qs}`),
        api.get<PlanPrice[]>('/membership-plans'),
        api.get<VoucherBookRow[]>(`/voucher-tickets/books?${qs}`),
      ]);
      setPlans(planList);
      setMembershipSales(memberships);
      setVoucherBooks(books);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.transactions.failLoadPurchases', 'Failed to load purchase data'));
    } finally {
      setPurchasesLoading(false);
    }
  }, [dateFrom, dateTo, branchQs, rangeInvalid, t]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { loadPurchases(); }, [loadPurchases]);

  const paymentLabel = (m: string) => ({
    cash: t('dash.transactions.pmCash', 'Cash'),
    qris_static: t('dash.transactions.pmQrisStatic', 'QRIS (static)'),
    qris_dynamic: t('dash.transactions.pmQrisDynamic', 'QRIS'),
    edc: t('dash.transactions.pmEdc', 'EDC / Debit'),
    cc: t('dash.transactions.pmCc', 'Credit card'),
    transfer: t('dash.transactions.pmTransfer', 'Bank transfer'),
  }[m] ?? m);

  const planPrice = (planName: string) => plans.find((p) => p.name === planName)?.price ?? 0;
  const membershipRevenue = membershipSales.reduce((a, m) => a + planPrice(m.planName), 0);
  const voucherRevenue = voucherBooks.reduce((a, b) => a + b.quantity * b.unitPrice, 0);

  // Product mix comes from the server as ONE list: services, membership plans
  // and voucher packs are all ordinary order lines since the POS merge, and
  // /reports/summary also folds in pre-merge pack orders (which carried no line
  // items). Merging any of it here again would double-count (Samuel 2026-07-30).
  const productRows: ProductRow[] = (summary?.byService ?? []).map((s) => ({
    name: s.name,
    quantity: s.quantity,
    revenue: s.revenue,
    kind: s.kind === 'membership_plan' ? 'membership' : s.kind === 'voucher_pack' ? 'voucher' : 'service',
  }));
  const productTotal = productRows.reduce((a, r) => a + r.revenue, 0);

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
    const rows = orders.map((o) => `<tr><td>${o.orderNumber}</td><td>${new Date(o.createdAt).toLocaleString()}</td><td>${o.customerName}</td><td>${o.customerPhone}</td><td>${o.isMember ? t('dash.transactions.memberOnly', 'Member') : t('dash.transactions.nonMemberOnly', 'Non-member')}</td><td>${o.paymentMethod ? paymentLabel(o.paymentMethod) : ''}</td><td>${o.status}</td><td>${o.total}</td></tr>`).join('');
    const html = `<table border="1"><thead><tr><th>${t('dash.transactions.order', 'Order')}</th><th>${t('dash.transactions.date', 'Date')}</th><th>${t('dash.transactions.customer', 'Customer')}</th><th>${t('dash.transactions.phone', 'Phone')}</th><th>${t('dash.transactions.customerType', 'Customer type')}</th><th>${t('dash.transactions.paymentMethod', 'Payment')}</th><th>${t('dash.transactions.status', 'Status')}</th><th>${t('dash.transactions.total', 'Total')}</th></tr></thead><tbody>${rows}</tbody></table>`;
    const blob = new Blob([`\ufeff<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `transactions-${dateFrom}-to-${dateTo}.xls`; a.click(); URL.revokeObjectURL(a.href);
  };

  const exportPdf = () => {
    if (!summary) return;
    const insHtml = insights.map((i) => `<li>${i}</li>`).join('');
    // Same merged list the on-screen chart uses — memberships and voucher packs included.
    const svcRows = productRows.map((s) => `<tr><td>${s.name}</td><td style="text-align:right">${s.quantity}</td><td style="text-align:right">${fmt(s.revenue)}</td></tr>`).join('');
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
  const productBars = productRows.map((r) => ({ label: r.name, value: r.revenue, kind: r.kind, quantity: r.quantity }));
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
      {rangeError && <div role="alert" data-testid="transactions-range-error" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{rangeError}</div>}

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {/* max/min keep the native pickers from offering an inverted range at
              all; rangeInvalid still guards typed/pasted values. */}
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.from', 'From')}</label><input aria-label={t('dash.transactions.dateFrom', 'Date From')} type="date" value={dateFrom} max={dateTo || undefined} aria-invalid={rangeInvalid} onChange={(e) => setDateFrom(e.target.value)} className={`input-field ${rangeInvalid ? 'border-red-400' : ''}`} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.to', 'To')}</label><input aria-label={t('dash.transactions.dateTo', 'Date To')} type="date" value={dateTo} min={dateFrom || undefined} aria-invalid={rangeInvalid} onChange={(e) => setDateTo(e.target.value)} className={`input-field ${rangeInvalid ? 'border-red-400' : ''}`} /></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.groupBy', 'Group by')}</label>
            <select aria-label={t('dash.transactions.granularity', 'Granularity')} value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')} className="input-field">
              <option value="day">{t('dash.transactions.daily', 'Daily')}</option><option value="week">{t('dash.transactions.weekly', 'Weekly')}</option><option value="month">{t('dash.transactions.monthly', 'Monthly')}</option>
            </select></div>
          <div><label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.transactions.businessUnit', 'Business unit')}</label>
            <select aria-label={t('dash.transactions.businessUnit', 'Business unit')} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value as '' | 'AIRE' | 'LEAD')} className="input-field">
              <option value="">{t('dash.transactions.all', 'All')}</option><option value="AIRE">AIRE</option><option value="LEAD">LEAD</option>
            </select></div>
          <BranchFilter value={branch} onChange={setBranch} label={t('dash.transactions.branch', 'Branch')} />
          {/* Overrides the From/To range with today — the shortcut the owner
              reaches for most, so it sits with the dates it replaces. */}
          <label className="flex items-center gap-1.5 text-sm text-text-secondary pb-2" data-testid="today-only-filter">
            <input type="checkbox" checked={todayOnly} onChange={(e) => { setTodayOnly(e.target.checked); setPage(1); }} />
            {t('dash.transactions.todayOnly', 'Today only')}
          </label>
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
        <div className="card">
          <h2 className="section-title mb-1">{t('dash.transactions.salesPerProduct', 'Sales per product')}</h2>
          <p className="text-xs text-text-muted mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary-500" />{t('dash.transactions.legendService', 'Service')}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500" />{t('dash.transactions.legendMembership', 'Membership')}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" />{t('dash.transactions.legendVoucher', 'Voucher pack')}</span>
          </p>
          <Bars data={productBars} />

          {/* The bars answer "which is biggest"; the owner also wants the actual
              numbers readable at a glance, the way the old report showed them. */}
          {productRows.length > 0 && (
            <div className="mt-4 -mx-5 -mb-5 border-t border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-sunken/50 text-xs uppercase text-text-secondary">
                    <th className="text-left px-5 py-2 font-medium">{t('dash.transactions.product', 'Product')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dash.transactions.qty', 'Qty')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dash.transactions.revenue', 'Revenue')}</th>
                    <th className="text-right px-5 py-2 font-medium">{t('dash.transactions.share', 'Share')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {productRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2">
                        <span className={`inline-block w-2 h-2 rounded-sm mr-2 align-middle ${KIND_BAR[r.kind]}`} />
                        {r.name}
                      </td>
                      <td className="px-3 py-2 text-right text-text-secondary">{r.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(r.revenue)}</td>
                      <td className="px-5 py-2 text-right text-text-muted">{productTotal > 0 ? `${Math.round((r.revenue / productTotal) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-surface-sunken/30 font-medium">
                    <td className="px-5 py-2">{t('dash.transactions.total', 'Total')}</td>
                    <td className="px-3 py-2 text-right">{productRows.reduce((a, r) => a + r.quantity, 0)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(productTotal)}</td>
                    <td className="px-5 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* AI Analysis */}
      <div className="card mb-6">
        <h2 className="section-title mb-3 flex items-center gap-2"><Bot className="w-4 h-4" />{t('dash.transactions.aiAnalysis', 'AI Analysis')}</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
          {insights.map((i, idx) => <li key={idx}>{i}</li>)}
        </ul>
      </div>

      {/* Membership & voucher-pack purchases — AIRIN-133 */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-0 overflow-hidden" data-testid="membership-purchases-section">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">{t('dash.transactions.membershipPurchases', 'Membership purchases')} ({membershipSales.length})</h2>
            <span className="text-sm font-mono text-text-secondary">{fmt(membershipRevenue)}</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.customer', 'Customer')}</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.plan', 'Plan')}</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.date', 'Date')}</th>
              <th className="text-center px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.status', 'Status')}</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.total', 'Total')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {purchasesLoading ? (
                <tr><td colSpan={5} className="px-4 py-5 text-sm text-text-muted text-center">{t('dash.transactions.loading', 'Loading…')}</td></tr>
              ) : membershipSales.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-5 text-sm text-text-muted text-center">{t('dash.transactions.noMembershipPurchases', 'No membership purchases in this range.')}</td></tr>
              ) : membershipSales.map((m) => {
                const badge = memberBadge(m.displayStatus);
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 text-sm">{m.customerName}</td>
                    <td className="px-4 py-2.5 text-sm text-text-secondary">{m.planName}</td>
                    <td className="px-4 py-2.5 text-xs text-text-muted">{fmtDate(m.purchaseDate ?? m.startDate)}</td>
                    <td className="px-4 py-2.5 text-center"><span className={`badge capitalize ${badge.cls}`}>{t(badge.key, badge.label)}</span></td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono">{fmt(planPrice(m.planName))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card p-0 overflow-hidden" data-testid="voucher-pack-purchases-section">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">{t('dash.transactions.voucherPackPurchases', 'Voucher-pack purchases')} ({voucherBooks.length})</h2>
            <span className="text-sm font-mono text-text-secondary">{fmt(voucherRevenue)}</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.buyer', 'Buyer')}</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.date', 'Date')}</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.qty', 'Qty')}</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.unitPrice', 'Unit price')}</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.total', 'Total')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {purchasesLoading ? (
                <tr><td colSpan={5} className="px-4 py-5 text-sm text-text-muted text-center">{t('dash.transactions.loading', 'Loading…')}</td></tr>
              ) : voucherBooks.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-5 text-sm text-text-muted text-center">{t('dash.transactions.noVoucherPackPurchases', 'No voucher-pack purchases in this range.')}</td></tr>
              ) : voucherBooks.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5 text-sm">{b.buyerName}<div className="text-xs text-text-muted">{b.buyerPhone}</div></td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">{fmtDate(b.createdAt)}</td>
                  <td className="px-4 py-2.5 text-sm text-right">{b.quantity}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono">{fmt(b.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono">{fmt(b.quantity * b.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transactions table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">{t('dash.transactions.title', 'Transactions')} ({total})</h2>
          <div className="flex items-center gap-3">
            {/* "Today only" lives with the other filters at the top of the page
                now — it is a date filter, and buried down here beside the page
                size nobody found it (AIRIN-172). */}
            <select aria-label={t('dash.transactions.pageSize', 'Page Size')} className="input-field py-1 text-xs" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Quick filters — payment method and member/non-member. Applied
            server-side, so the count above and the pager match the rows. */}
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="transactions-filters">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted mr-1">{t('dash.transactions.paymentMethod', 'Payment')}</span>
            <FilterChip active={paymentMethod === ''} onClick={() => { setPaymentMethod(''); setPage(1); }}>{t('dash.transactions.all', 'All')}</FilterChip>
            {PAYMENT_METHODS.map((m) => (
              <FilterChip key={m} active={paymentMethod === m} onClick={() => { setPaymentMethod(m); setPage(1); }}>{paymentLabel(m)}</FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted mr-1">{t('dash.transactions.customerType', 'Customer')}</span>
            <FilterChip active={memberFilter === ''} onClick={() => { setMemberFilter(''); setPage(1); }}>{t('dash.transactions.all', 'All')}</FilterChip>
            <FilterChip active={memberFilter === 'member'} onClick={() => { setMemberFilter('member'); setPage(1); }}>{t('dash.transactions.memberOnly', 'Member')}</FilterChip>
            <FilterChip active={memberFilter === 'non_member'} onClick={() => { setMemberFilter('non_member'); setPage(1); }}>{t('dash.transactions.nonMemberOnly', 'Non-member')}</FilterChip>
          </div>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-border bg-surface-sunken/50">
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.order', 'Order')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.customer', 'Customer')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.paymentMethod', 'Payment')}</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.status', 'Status')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.total', 'Total')}</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.transactions.actions', 'Actions')}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {orders.length === 0 ? <tr><td colSpan={6} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.transactions.noTransactions', 'No transactions.')}</td></tr> : orders.map((o) => (
              <tr key={o.id}>
                <td className="px-5 py-3 text-sm font-medium">{o.orderNumber}<div className="text-xs text-text-muted">{new Date(o.createdAt).toLocaleString()}</div></td>
                <td className="px-5 py-3 text-sm">
                  {o.customerName}
                  {o.isMember && <span className="ml-1.5 badge bg-violet-50 text-violet-700">{t('dash.transactions.memberOnly', 'Member')}</span>}
                  <div className="text-xs text-text-muted">{o.customerPhone}</div>
                  {/* Why this order's money moved, and what it earned. Kept to short
                      chips here; the View dialog names each one in full. */}
                  {(o.discountSources ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(o.discountSources ?? []).map((d, i) => (
                        <span
                          key={`${d.label}-${i}`}
                          title={d.label + (d.viaCampaign ? ` (${d.viaCampaign})` : '')}
                          className={`badge text-[10px] ${
                            d.kind === 'promo' ? 'bg-fuchsia-50 text-fuchsia-700'
                              : d.kind === 'campaign' ? 'bg-violet-50 text-violet-700'
                                : 'bg-sky-50 text-sky-700'
                          }`}
                        >
                          {d.kind === 'promo' ? t('dash.transactions.promoTag', 'Promo')
                            : d.kind === 'campaign' ? t('dash.transactions.earnedTag', 'Earned')
                              : t('dash.transactions.voucherTag', 'Voucher')}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                {/* Unpaid orders have no method yet — show a dash, not a blank cell. */}
                <td className="px-5 py-3 text-sm text-text-secondary">{o.paymentMethod ? paymentLabel(o.paymentMethod) : <span className="text-text-muted">—</span>}</td>
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
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.paymentMethod', 'Payment')}</span><span>{detail.paymentMethod ? paymentLabel(detail.paymentMethod) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.customerType', 'Customer type')}</span><span>{detail.isMember ? t('dash.transactions.memberOnly', 'Member') : t('dash.transactions.nonMemberOnly', 'Non-member')}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.status', 'Status')}</span><span className="capitalize">{detail.status}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.total', 'Total')}</span><span className="font-medium">{fmt(detail.total)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">{t('dash.transactions.date', 'Date')}</span><span>{new Date(detail.createdAt).toLocaleString()}</span></div>
            </div>

            {/* What was actually sold, and why each line cost what it did. The
                dialog previously showed totals only, so a Rp 0 line could not be
                explained from here at all. */}
            {(detail.items ?? []).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-text-muted mb-1.5">{t('dash.transactions.items', 'Items')}</p>
                <div className="space-y-1">
                  {(detail.items ?? []).map((it, i) => (
                    <div key={i} className="flex justify-between items-start text-sm gap-2">
                      <span>
                        {it.quantity}× {it.serviceName}
                        {it.itemType === 'membership_plan' && <span className="badge bg-violet-50 text-violet-700 text-[10px] ml-1.5">{t('dash.transactions.membershipTag', 'Membership')}</span>}
                        {it.itemType === 'voucher_pack' && <span className="badge bg-amber-50 text-amber-700 text-[10px] ml-1.5">{t('dash.transactions.voucherPackTag', 'Voucher pack')}</span>}
                        {it.isMemberPricing && (
                          <span className="badge bg-emerald-50 text-emerald-700 text-[10px] ml-1.5">
                            {it.memberDiscountType === 'percentage' && it.memberDiscountValue
                              ? `${t('dash.transactions.member', 'MEMBER')} −${Math.round(it.memberDiscountValue * 100)}%`
                              : it.memberDiscountType === 'free' || it.subtotal === 0
                                ? t('dash.transactions.memberFree', 'MEMBER · FREE')
                                : t('dash.transactions.memberPrice', 'MEMBER PRICE')}
                          </span>
                        )}
                      </span>
                      <span className="font-mono whitespace-nowrap">{fmt(it.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(detail.discountSources ?? []).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border space-y-1">
                {(detail.discountSources ?? []).map((d, i) => (
                  <div key={`${d.label}-${i}`} className="text-xs">
                    <span className="text-text-muted">
                      {d.kind === 'campaign'
                        ? t('dash.transactions.earnedLabel', 'Earned:')
                        : d.kind === 'promo'
                          ? t('dash.transactions.promoLabel', 'Promo:')
                          : t('dash.transactions.voucherLabel', 'Voucher:')}
                    </span>{' '}
                    <span className="text-text-primary">{d.label}</span>
                    {d.amount ? <span className="text-green-600"> −{fmt(d.amount)}</span> : null}
                    {d.viaCampaign && d.kind !== 'campaign' && (
                      <span className="text-text-muted"> · {t('dash.transactions.viaCampaign', 'from campaign')} {d.viaCampaign}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
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
