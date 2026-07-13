'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, StatCard, Panel, Tabs, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtIDR, fmtDate } from '@/components/dashboard/ui';

interface Tenant { id: string; name: string; plan: string; status: 'active' | 'suspended' | 'cancelled' }
interface PlatformConfig { pricingTiers: { plan: string; price: number }[] }
interface PlatformPlan { code: string; price: number; billingCycle: 'monthly' | 'annual' }
interface PlanRow { plan: string; price: number; total: number; active: number; mrr: number }

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
interface Invoice {
  id: string; tenantId: string; tenantName: string | null; period: string; planCode: string | null;
  amount: number; currency: string; status: InvoiceStatus; issuedAt: string | null; dueDate: string | null;
  paidAt: string | null; notes: string | null;
}
interface InvoiceSummary { outstanding: number; overdue: number; paidThisMonth: number; countByStatus: Record<InvoiceStatus, number> }

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  draft: 'bg-surface-sunken text-text-secondary', sent: 'bg-sky-50 text-sky-700',
  paid: 'bg-green-50 text-green-700', overdue: 'bg-rose-50 text-rose-700', void: 'bg-surface-sunken text-text-muted',
};

function currentPeriod(): string {
  // Rendered client-side only; safe to read the clock here.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ── Overview tab (estimated MRR from active subscriptions) ─────────────── */
function OverviewTab() {
  const { t } = useI18n();
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [mrr, setMrr] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [tenants, plans, config] = await Promise.all([
        api.get<Tenant[]>('/admin/tenants'),
        api.get<PlatformPlan[]>('/admin/platform-plans').catch(() => [] as PlatformPlan[]),
        api.get<PlatformConfig>('/admin/config'),
      ]);
      const planPrice = new Map<string, number>();
      for (const p of plans) planPrice.set(p.code, p.billingCycle === 'annual' ? p.price / 12 : p.price);
      for (const c of config.pricingTiers ?? []) if (!planPrice.has(c.plan)) planPrice.set(c.plan, Number(c.price) || 0);
      const priceOf = (plan: string) => planPrice.get(plan) ?? 0;
      const byPlan = new Map<string, PlanRow>();
      for (const tenant of tenants) {
        const key = tenant.plan || 'unspecified';
        const row = byPlan.get(key) ?? { plan: key, price: priceOf(key), total: 0, active: 0, mrr: 0 };
        row.total += 1;
        if (tenant.status === 'active') { row.active += 1; row.mrr += row.price; }
        byPlan.set(key, row);
      }
      const planRows = Array.from(byPlan.values()).sort((a, b) => b.mrr - a.mrr);
      setRows(planRows);
      setMrr(planRows.reduce((s, r) => s + r.mrr, 0));
      setActiveCount(tenants.filter((tenant) => tenant.status === 'active').length);
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.billing.failedToLoad', 'Failed to load billing data')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('admin.billing.estimatedMrr', 'Estimated MRR')} value={fmtIDR(mrr)} tone="primary" loading={loading} />
        <StatCard label={t('admin.billing.activeSubscriptions', 'Active subscriptions')} value={String(activeCount)} loading={loading} />
        <StatCard label={t('admin.billing.annualRunRate', 'Annual run rate')} value={fmtIDR(mrr * 12)} tone="positive" loading={loading} />
      </div>
      <Panel title={t('admin.billing.byPlan', 'By plan')} bodyClassName="p-0">
        {loading ? <TableSkeleton rows={4} cols={5} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.billing.colPlan', 'Plan')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.billing.colPricePerMo', 'Price / mo')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.billing.colTenants', 'Tenants')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.billing.colActive', 'Active')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.billing.colMrr', 'MRR')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <EmptyRow colSpan={5}>{t('admin.billing.noTenants', 'No tenants yet.')}</EmptyRow>
              ) : rows.map((r) => (
                <tr key={r.plan} className="hover:bg-surface-sunken/50">
                  <td className={cn(tdCls, 'font-medium capitalize')}>{r.plan}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{r.price > 0 ? fmtIDR(r.price) : <span className="text-text-muted">{t('admin.billing.notSet', 'not set')}</span>}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{r.total}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{r.active}</td>
                  <td className={cn(tdCls, 'text-right font-medium tabular-nums')}>{fmtIDR(r.mrr)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      <p className="text-xs text-text-muted">{t('admin.billing.mrrNote', 'MRR is estimated from active tenants and the pricing tiers configured under Platform Config.')}</p>
    </div>
  );
}

/* ── Invoices tab (real issued invoices + payment status) ─────────────────── */
function InvoicesTab() {
  const { t } = useI18n();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | InvoiceStatus>('');
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const [inv, sum] = await Promise.all([
        api.get<Invoice[]>(`/admin/invoices${qs}`),
        api.get<InvoiceSummary>('/admin/invoices/summary'),
      ]);
      setInvoices(inv); setSummary(sum);
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.billing.invFailed', 'Failed to load invoices')); }
    finally { setLoading(false); }
  }, [statusFilter, t]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api.post<{ created: number; skipped: number }>('/admin/invoices/generate', { period });
      setMsg(t('admin.billing.generated', 'Generated {c} invoices ({s} already existed).').replace('{c}', String(r.created)).replace('{s}', String(r.skipped)));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.billing.genFailed', 'Generation failed')); }
    finally { setBusy(false); }
  };

  const setStatus = async (inv: Invoice, status: InvoiceStatus) => {
    try { await api.patch(`/admin/invoices/${inv.id}/status`, { status }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.billing.actionFailed', 'Action failed')); }
  };

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {msg && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{msg}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('admin.billing.outstanding', 'Outstanding')} value={summary ? fmtIDR(summary.outstanding) : '—'} tone="warning" loading={loading} />
        <StatCard label={t('admin.billing.overdue', 'Overdue')} value={summary ? fmtIDR(summary.overdue) : '—'} tone="negative" loading={loading} />
        <StatCard label={t('admin.billing.paidThisMonth', 'Paid this month')} value={summary ? fmtIDR(summary.paidThisMonth) : '—'} tone="positive" loading={loading} />
      </div>

      <Panel
        title={t('admin.billing.invoices', 'Invoices')}
        actions={
          <div className="flex items-center gap-2">
            <input className="input-field max-w-[120px] text-sm" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="YYYY-MM" aria-label={t('admin.billing.period', 'Period')} />
            <button className="btn-primary text-xs whitespace-nowrap" onClick={generate} disabled={busy}>{busy ? t('admin.billing.generating', 'Generating…') : t('admin.billing.generate', 'Generate drafts')}</button>
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <select className="input-field max-w-[160px] text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | InvoiceStatus)}>
            <option value="">{t('admin.billing.allStatuses', 'All statuses')}</option>
            <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option>
          </select>
        </div>
        {loading ? <TableSkeleton rows={6} cols={6} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.billing.tenant', 'Tenant')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.billing.periodCol', 'Period')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.billing.amount', 'Amount')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.billing.due', 'Due')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.billing.status', 'Status')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.billing.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.length === 0 ? (
                <EmptyRow colSpan={6}>{t('admin.billing.noInvoices', 'No invoices. Generate drafts for a period to start.')}</EmptyRow>
              ) : invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-surface-sunken/50">
                  <td className={cn(tdCls, 'font-medium')}>{inv.tenantName ?? '—'}<span className="block text-xs text-text-muted capitalize font-normal">{inv.planCode ?? '—'}</span></td>
                  <td className={cn(tdCls, 'font-mono text-xs')}>{inv.period}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{fmtIDR(inv.amount)}</td>
                  <td className={cn(tdCls, 'text-xs text-text-muted whitespace-nowrap')}>{fmtDate(inv.dueDate)}</td>
                  <td className={tdCls}><span className={cn('badge capitalize', INVOICE_BADGE[inv.status])}>{inv.status}</span></td>
                  <td className={cn(tdCls, 'text-right whitespace-nowrap')}>
                    {inv.status === 'draft' && <button className="btn-ghost text-xs text-sky-600" onClick={() => setStatus(inv, 'sent')}>{t('admin.billing.markSent', 'Send')}</button>}
                    {(inv.status === 'sent' || inv.status === 'overdue') && <button className="btn-ghost text-xs text-green-600" onClick={() => setStatus(inv, 'paid')}>{t('admin.billing.markPaid', 'Mark paid')}</button>}
                    {inv.status === 'sent' && <button className="btn-ghost text-xs text-amber-600" onClick={() => setStatus(inv, 'overdue')}>{t('admin.billing.markOverdue', 'Overdue')}</button>}
                    {inv.status !== 'paid' && inv.status !== 'void' && <button className="btn-ghost text-xs text-rose-600" onClick={() => setStatus(inv, 'void')}>{t('admin.billing.void', 'Void')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

export default function AdminBillingPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'overview' | 'invoices'>('overview');
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    // Cheap probe to surface the access-denied panel consistently with other pages.
    api.get('/admin/config').catch((err) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
    });
  }, []);

  if (forbidden) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-text-primary mb-2">{t('admin.billing.accessDenied', 'Access Denied')}</h1>
        <p className="text-sm text-text-secondary">{t('admin.billing.accessDeniedDesc', 'This area requires a Platform Super Admin account. You are signed in as ')}<span className="font-medium">{getUser()?.role?.replace(/_/g, ' ')}</span>.</p>
        <button onClick={logout} className="btn-secondary mt-4">{t('admin.billing.signInDifferent', 'Sign in as different user')}</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-billing">
      <PageHeader
        title={t('admin.billing.title', 'Billing')}
        subtitle={t('admin.billing.subtitle', 'Estimated recurring revenue and the real invoices issued to each tenant.')}
        actions={
          <Tabs
            tabs={[{ id: 'overview', label: t('admin.billing.tabOverview', 'Overview') }, { id: 'invoices', label: t('admin.billing.tabInvoices', 'Invoices') }]}
            active={tab}
            onChange={setTab}
          />
        }
      />
      {tab === 'overview' ? <OverviewTab /> : <InvoicesTab />}
    </div>
  );
}
