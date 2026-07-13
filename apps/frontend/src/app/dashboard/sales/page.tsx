'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { cn } from '@/lib/utils';
import {
  PageHeader, StatCard, Panel, ErrorBanner, Modal, Field,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls,
  fmtIDR, fmtDate, Spinner,
} from '@/components/dashboard/ui';

interface Summary {
  period: string;
  actual: number;
  target: number;
  attainmentPct: number | null;
  projected: number;
  projectedAttainmentPct: number | null;
  dayOfMonth: number;
  daysInMonth: number;
  orders: number;
  leadFunnel: Record<string, number>;
}
interface Lead {
  id: string; name: string; phone: string | null; source: string | null;
  status: string; notes: string | null; createdAt: string;
}
interface Targets {
  period: string;
  overall: number | null;
  branches: { outletId: string; outletName: string; targetAmount: number }[];
}
interface BranchPerf {
  outletId: string; name: string; revenue: number; orders: number;
  target: number | null; attainmentPct: number | null;
}
interface EmployeePerf {
  operatorId: string; name: string; outletId: string; outletName: string;
  revenue: number; orders: number; avgOrder: number;
}
interface Performance { period: string; byBranch: BranchPerf[]; byEmployee: EmployeePerf[]; }
interface Outlet { id: string; name: string; }

/** Pipeline stages in funnel order; `lost` is a terminal off-ramp. */
const ALL_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
type Status = (typeof ALL_STATUSES)[number];

const STAGE_TONE: Record<Status, string> = {
  new: 'bg-sky-500', contacted: 'bg-amber-500', won: 'bg-green-500', lost: 'bg-rose-500',
};
const STAGE_CHIP: Record<Status, string> = {
  new: 'bg-sky-50 text-sky-700', contacted: 'bg-amber-50 text-amber-700',
  won: 'bg-green-50 text-green-700', lost: 'bg-rose-50 text-rose-700',
};

const OVERALL = '__overall__';

export default function SalesPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>('');

  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [q, setQ] = useState('');
  const [showLead, setShowLead] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', source: '', notes: '' });
  const [targetScope, setTargetScope] = useState<string>(OVERALL);
  const [targetAmt, setTargetAmt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scope = branch ? `?outletId=${branch}` : '';
      const [s, l, tg, pf] = await Promise.all([
        api.get<Summary>(`/sales/summary${scope}`),
        api.get<Lead[]>('/sales/leads'),
        api.get<Targets>('/sales/targets'),
        api.get<Performance>(`/sales/performance${scope}`),
      ]);
      setSummary(s); setLeads(l); setTargets(tg); setPerf(pf); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.sales.failedToLoad', 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [branch, t]);
  useEffect(() => { load(); }, [load]);

  // Outlets power the target-scope selector (owner/super-admin only; harmless empty otherwise).
  useEffect(() => { api.get<Outlet[]>('/outlets').then(setOutlets).catch(() => setOutlets([])); }, []);

  const createLead = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.post('/sales/leads', {
        name: form.name.trim(),
        phone: form.phone || undefined,
        source: form.source || undefined,
        notes: form.notes || undefined,
      });
      setForm({ name: '', phone: '', source: '', notes: '' });
      setShowLead(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.sales.failed', 'Failed'));
    } finally { setSaving(false); }
  };

  const setLeadStatus = async (lead: Lead, status: Status) => {
    if (lead.status === status) return;
    setBusy(lead.id);
    try {
      await api.patch(`/sales/leads/${lead.id}/status`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.sales.failed', 'Failed'));
    } finally { setBusy(''); }
  };

  const openTarget = () => {
    // Default the scope to the branch currently filtered, else overall; prefill amount.
    const scope = branch || OVERALL;
    setTargetScope(scope);
    setTargetAmt(String(targetOf(scope) ?? ''));
    setShowTarget(true);
  };
  const targetOf = (scope: string): number | null => {
    if (!targets) return null;
    if (scope === OVERALL) return targets.overall;
    return targets.branches.find((b) => b.outletId === scope)?.targetAmount ?? null;
  };
  const saveTarget = async () => {
    if (!Number(targetAmt)) return;
    setSaving(true);
    const period = new Date().toISOString().slice(0, 7);
    try {
      await api.post('/sales/targets', {
        period,
        targetAmount: Number(targetAmt),
        outletId: targetScope === OVERALL ? undefined : targetScope,
      });
      setShowTarget(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.sales.failed', 'Failed'));
    } finally { setSaving(false); }
  };

  const funnel = summary?.leadFunnel ?? {};
  const totalLeads = ALL_STATUSES.reduce((s, k) => s + (funnel[k] ?? 0), 0);
  const wonCount = funnel.won ?? 0;
  const conversionPct = totalLeads > 0 ? Math.round((wonCount / totalLeads) * 100) : null;
  const maxStage = Math.max(1, ...ALL_STATUSES.map((k) => funnel[k] ?? 0));

  const pacePct = summary && summary.daysInMonth > 0
    ? Math.round((summary.dayOfMonth / summary.daysInMonth) * 100) : 0;
  const attain = summary?.attainmentPct;
  const onTrack = summary?.projectedAttainmentPct != null && summary.projectedAttainmentPct >= 100;

  const shownLeads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (!needle) return true;
      return [l.name, l.phone, l.source].some((v) => (v ?? '').toLowerCase().includes(needle));
    });
  }, [leads, statusFilter, q]);

  const tabs: { id: 'all' | Status; label: string }[] = [
    { id: 'all', label: t('dash.sales.all', 'All') },
    ...ALL_STATUSES.map((s) => ({ id: s, label: t(`dash.sales.status.${s}`, s[0]!.toUpperCase() + s.slice(1)) })),
  ];

  // Performance derived helpers — best/worst markers for leaderboards.
  const employees = perf?.byEmployee ?? [];
  const branchesPerf = perf?.byBranch ?? [];
  const maxEmpRevenue = Math.max(1, ...employees.map((e) => e.revenue));
  const bestEmpId = employees[0]?.operatorId;
  const worstEmpId = employees.length > 1 ? employees[employees.length - 1]?.operatorId : undefined;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.sales.title', 'Sales')}
        subtitle={t('dash.sales.subtitle', 'Track revenue against overall and per-branch targets, rank branch and staff performance, and manage the lead pipeline from first contact to close.')}
        actions={
          <>
            <BranchFilter value={branch} onChange={setBranch} label={t('dash.sales.branch', 'Branch')} />
            <div className="flex items-end gap-2">
              <button className="btn-secondary" onClick={openTarget}>{t('dash.sales.setTarget', 'Set target')}</button>
              <button className="btn-primary" onClick={() => setShowLead(true)}>+ {t('dash.sales.newLead', 'New lead')}</button>
            </div>
          </>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('dash.sales.actual', 'Actual revenue')} value={fmtIDR(summary?.actual ?? 0)} tone="positive"
          hint={summary ? `${summary.orders} ${t('dash.sales.orders', 'orders')} · ${summary.period}` : undefined} loading={loading} />
        <StatCard label={t('dash.sales.forecast', 'Forecast (month-end)')} value={fmtIDR(summary?.projected ?? 0)} tone="primary"
          hint={summary ? `${t('dash.sales.runRate', 'run-rate, day')} ${summary.dayOfMonth}/${summary.daysInMonth}` : undefined} loading={loading} />
        <StatCard label={t('dash.sales.target', 'Target')} value={summary?.target ? fmtIDR(summary.target) : '—'}
          hint={!summary?.target ? t('dash.sales.noTarget', 'not set') : (branch ? t('dash.sales.branchTarget', 'branch') : t('dash.sales.overallTarget', 'overall'))} loading={loading} />
        <StatCard label={t('dash.sales.attainment', 'Attainment')} value={attain != null ? `${attain}%` : '—'}
          tone={attain == null ? 'default' : onTrack ? 'positive' : 'warning'}
          hint={summary?.projectedAttainmentPct != null ? `${t('dash.sales.projected', 'projected')} ${summary.projectedAttainmentPct}%` : undefined} loading={loading} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Attainment pacing */}
        <Panel title={t('dash.sales.targetProgress', 'Target progress')}
          description={`${summary?.period ?? ''} · ${branch ? t('dash.sales.branchTarget', 'branch') : t('dash.sales.overallTarget', 'overall')}`}
          actions={<button className="btn-ghost text-xs" onClick={openTarget}>{t('dash.sales.edit', 'Edit')}</button>}>
          {loading ? (
            <div className="h-24 animate-pulse rounded bg-surface-sunken" />
          ) : !summary?.target ? (
            <div className="py-6 text-center">
              <p className="text-sm text-text-muted">{t('dash.sales.noTargetHint', 'No target set for this scope.')}</p>
              <button className="btn-secondary mt-3" onClick={openTarget}>{t('dash.sales.setTarget', 'Set target')}</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{t('dash.sales.actualVsTarget', 'Actual vs target')}</span>
                  <span className="font-semibold tabular-nums text-text-primary">{fmtIDR(summary.actual)} / {fmtIDR(summary.target)}</span>
                </div>
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-sunken">
                  <div className={cn('h-full rounded-full transition-all', onTrack ? 'bg-green-500' : 'bg-amber-500')}
                    style={{ width: `${Math.min(100, attain ?? 0)}%` }} />
                  {/* Pace marker: where we should be today for a linear path to target. */}
                  <div className="absolute top-0 h-full border-r-2 border-dashed border-text-primary/40" style={{ left: `${Math.min(100, pacePct)}%` }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-text-muted">
                  <span>{attain ?? 0}% {t('dash.sales.achieved', 'achieved')}</span>
                  <span>{t('dash.sales.pace', 'pace')} {pacePct}%</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                <div>
                  <p className="text-xs text-text-muted">{t('dash.sales.remaining', 'Remaining to target')}</p>
                  <p className="font-semibold tabular-nums text-text-primary">{fmtIDR(Math.max(0, summary.target - summary.actual))}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">{t('dash.sales.projectedGap', 'Projected vs target')}</p>
                  <p className={cn('font-semibold tabular-nums', onTrack ? 'text-green-600' : 'text-amber-600')}>
                    {onTrack ? '+' : ''}{fmtIDR(summary.projected - summary.target)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* Lead pipeline funnel */}
        <Panel title={t('dash.sales.pipeline', 'Lead pipeline')}
          description={conversionPct != null
            ? `${totalLeads} ${t('dash.sales.leads', 'leads')} · ${conversionPct}% ${t('dash.sales.conversion', 'conversion')}`
            : `${totalLeads} ${t('dash.sales.leads', 'leads')}`}>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-surface-sunken" />)}</div>
          ) : totalLeads === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">{t('dash.sales.noLeadsYet', 'No leads yet.')}</p>
          ) : (
            <div className="space-y-2.5">
              {ALL_STATUSES.map((s) => {
                const count = funnel[s] ?? 0;
                const pct = Math.round((count / maxStage) * 100);
                return (
                  <button key={s} onClick={() => setStatusFilter((f) => (f === s ? 'all' : s))}
                    className={cn('group block w-full text-left', statusFilter === s && 'ring-2 ring-primary-400 rounded-md')}
                    title={t('dash.sales.filterByStage', 'Filter leads by this stage')}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium capitalize text-text-secondary">{t(`dash.sales.status.${s}`, s)}</span>
                      <span className="tabular-nums font-semibold text-text-primary">{count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                      <div className={cn('h-full rounded-full transition-all', STAGE_TONE[s])} style={{ width: `${Math.max(count ? 4 : 0, pct)}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* Branch performance — only meaningful across branches (global view). */}
      {!branch && (
        <Panel title={t('dash.sales.branchPerformance', 'Branch performance')}
          description={`${summary?.period ?? ''} · ${t('dash.sales.rankedByRevenue', 'ranked by revenue')}`}
          bodyClassName="">
          {loading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : (
            <TableWrap>
              <thead>
                <tr className="border-b border-border text-left">
                  <th className={thCls}>{t('dash.sales.branch', 'Branch')}</th>
                  <th className={cn(thCls, 'text-right')}>{t('dash.sales.revenue', 'Revenue')}</th>
                  <th className={cn(thCls, 'text-right')}>{t('dash.sales.orders', 'Orders')}</th>
                  <th className={cn(thCls, 'text-right')}>{t('dash.sales.target', 'Target')}</th>
                  <th className={thCls}>{t('dash.sales.attainment', 'Attainment')}</th>
                </tr>
              </thead>
              <tbody>
                {branchesPerf.length === 0 ? (
                  <EmptyRow colSpan={5}>{t('dash.sales.noSalesYet', 'No sales this period.')}</EmptyRow>
                ) : branchesPerf.map((b, i) => (
                  <tr key={b.outletId} className="border-b border-border last:border-0">
                    <td className={tdCls}>
                      <span className="font-medium text-text-primary">{b.name}</span>
                      {i === 0 && b.revenue > 0 && <span className="ml-2 badge bg-green-50 text-green-700">{t('dash.sales.top', 'Top')}</span>}
                    </td>
                    <td className={cn(tdCls, 'text-right tabular-nums font-medium')}>{fmtIDR(b.revenue)}</td>
                    <td className={cn(tdCls, 'text-right tabular-nums text-text-secondary')}>{b.orders}</td>
                    <td className={cn(tdCls, 'text-right tabular-nums text-text-secondary')}>{b.target ? fmtIDR(b.target) : '—'}</td>
                    <td className={tdCls}>
                      {b.attainmentPct == null ? <span className="text-text-muted">—</span> : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-sunken">
                            <div className={cn('h-full rounded-full', b.attainmentPct >= 100 ? 'bg-green-500' : 'bg-amber-500')} style={{ width: `${Math.min(100, b.attainmentPct)}%` }} />
                          </div>
                          <span className={cn('tabular-nums text-xs font-medium', b.attainmentPct >= 100 ? 'text-green-600' : 'text-amber-600')}>{b.attainmentPct}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      )}

      {/* Employee leaderboard */}
      <Panel title={t('dash.sales.staffLeaderboard', 'Staff leaderboard')}
        description={`${summary?.period ?? ''} · ${branch ? t('dash.sales.thisBranch', 'this branch') : t('dash.sales.allBranches', 'all branches')}`}
        bodyClassName="">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border text-left">
                <th className={cn(thCls, 'w-10')}>#</th>
                <th className={thCls}>{t('dash.sales.staff', 'Staff')}</th>
                {!branch && <th className={thCls}>{t('dash.sales.branch', 'Branch')}</th>}
                <th className={cn(thCls, 'text-right')}>{t('dash.sales.revenue', 'Revenue')}</th>
                <th className={cn(thCls, 'text-right')}>{t('dash.sales.orders', 'Orders')}</th>
                <th className={cn(thCls, 'text-right')}>{t('dash.sales.avgOrder', 'Avg / order')}</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <EmptyRow colSpan={branch ? 5 : 6}>{t('dash.sales.noSalesYet', 'No sales this period.')}</EmptyRow>
              ) : employees.map((e, i) => (
                <tr key={e.operatorId} className={cn('border-b border-border last:border-0',
                  e.operatorId === bestEmpId && 'bg-green-50/40', e.operatorId === worstEmpId && 'bg-rose-50/30')}>
                  <td className={cn(tdCls, 'text-text-muted tabular-nums')}>{i + 1}</td>
                  <td className={tdCls}>
                    <span className="font-medium text-text-primary">{e.name}</span>
                    {e.operatorId === bestEmpId && <span className="ml-2 badge bg-green-50 text-green-700">🏆 {t('dash.sales.best', 'Best')}</span>}
                    {e.operatorId === worstEmpId && <span className="ml-2 badge bg-rose-50 text-rose-700">{t('dash.sales.needsAttention', 'Needs attention')}</span>}
                  </td>
                  {!branch && <td className={cn(tdCls, 'text-text-secondary')}>{e.outletName}</td>}
                  <td className={cn(tdCls, 'text-right')}>
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken sm:block">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.round((e.revenue / maxEmpRevenue) * 100)}%` }} />
                      </div>
                      <span className="tabular-nums font-medium text-text-primary">{fmtIDR(e.revenue)}</span>
                    </div>
                  </td>
                  <td className={cn(tdCls, 'text-right tabular-nums text-text-secondary')}>{e.orders}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums text-text-secondary')}>{fmtIDR(e.avgOrder)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {/* Leads table */}
      <Panel title={t('dash.sales.leads', 'Leads')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input className="input-field h-9 w-44" placeholder={t('dash.sales.searchLeads', 'Search leads…')} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="inline-flex flex-wrap rounded-lg bg-surface-sunken p-0.5">
              {tabs.map((tb) => (
                <button key={tb.id} onClick={() => setStatusFilter(tb.id)}
                  className={cn('rounded-md px-2.5 py-1 text-xs capitalize',
                    statusFilter === tb.id ? 'bg-surface-raised font-medium text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary')}>
                  {tb.label}
                  {tb.id !== 'all' && (funnel[tb.id] ?? 0) > 0 && <span className="ml-1 text-text-muted">{funnel[tb.id]}</span>}
                </button>
              ))}
            </div>
          </div>
        }
        bodyClassName="">
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border text-left">
                <th className={thCls}>{t('dash.sales.name', 'Name')}</th>
                <th className={thCls}>{t('dash.sales.contact', 'Contact')}</th>
                <th className={thCls}>{t('dash.sales.source', 'Source')}</th>
                <th className={thCls}>{t('dash.sales.created', 'Created')}</th>
                <th className={thCls}>{t('dash.sales.stage', 'Stage')}</th>
                <th className={cn(thCls, 'text-right')}>{t('dash.sales.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shownLeads.length === 0 ? (
                <EmptyRow colSpan={6}>
                  {leads.length === 0 ? t('dash.sales.noLeadsYet', 'No leads yet.') : t('dash.sales.noMatch', 'No leads match your filters.')}
                </EmptyRow>
              ) : shownLeads.map((l) => {
                const status = l.status as Status;
                return (
                  <tr key={l.id} className="border-b border-border last:border-0 hover:bg-surface-sunken/40">
                    <td className={tdCls}>
                      <span className="font-medium text-text-primary">{l.name}</span>
                      {l.notes && <p className="mt-0.5 max-w-xs truncate text-xs text-text-muted" title={l.notes}>{l.notes}</p>}
                    </td>
                    <td className={cn(tdCls, 'text-text-secondary')}>{l.phone || '—'}</td>
                    <td className={cn(tdCls, 'text-text-secondary')}>{l.source || '—'}</td>
                    <td className={cn(tdCls, 'text-text-secondary whitespace-nowrap')}>{fmtDate(l.createdAt)}</td>
                    <td className={tdCls}>
                      <span className={cn('badge capitalize', STAGE_CHIP[status] ?? 'bg-surface-sunken text-text-secondary')}>
                        {t(`dash.sales.status.${status}`, status)}
                      </span>
                    </td>
                    <td className={cn(tdCls, 'text-right')}>
                      {busy === l.id ? <Spinner className="text-text-muted" /> : (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {status === 'new' && <button className="btn-ghost text-xs" onClick={() => setLeadStatus(l, 'contacted')}>→ {t('dash.sales.status.contacted', 'Contacted')}</button>}
                          {(status === 'new' || status === 'contacted') && (
                            <>
                              <button className="btn-ghost text-xs text-green-600" onClick={() => setLeadStatus(l, 'won')}>{t('dash.sales.markWon', 'Won')}</button>
                              <button className="btn-ghost text-xs text-rose-600" onClick={() => setLeadStatus(l, 'lost')}>{t('dash.sales.markLost', 'Lost')}</button>
                            </>
                          )}
                          {(status === 'won' || status === 'lost') && <button className="btn-ghost text-xs text-text-muted" onClick={() => setLeadStatus(l, 'contacted')}>↺ {t('dash.sales.reopen', 'Reopen')}</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {/* New lead modal */}
      {showLead && (
        <Modal title={t('dash.sales.newLead', 'New lead')} onClose={() => setShowLead(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setShowLead(false)}>{t('dash.sales.cancel', 'Cancel')}</button>
              <button className="btn-primary" disabled={saving || !form.name.trim()} onClick={createLead}>{saving ? <Spinner /> : t('dash.sales.addLead', 'Add lead')}</button>
            </>
          }>
          <div className="space-y-4">
            <Field label={t('dash.sales.name', 'Name')}>
              <input className="input-field" placeholder={t('dash.sales.namePlaceholder', 'Full name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('dash.sales.phone', 'Phone')}>
                <input className="input-field" placeholder="08…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label={t('dash.sales.source', 'Source')} hint={t('dash.sales.sourceHint', 'e.g. Instagram, referral')}>
                <input className="input-field" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              </Field>
            </div>
            <Field label={t('dash.sales.notes', 'Notes')}>
              <textarea className="input-field min-h-[72px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {/* Set target modal */}
      {showTarget && (
        <Modal title={t('dash.sales.setMonthlyTarget', 'Set monthly target')} onClose={() => setShowTarget(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setShowTarget(false)}>{t('dash.sales.cancel', 'Cancel')}</button>
              <button className="btn-primary" disabled={saving || !Number(targetAmt)} onClick={saveTarget}>{saving ? <Spinner /> : t('dash.sales.save', 'Save')}</button>
            </>
          }>
          <div className="space-y-4">
            <p className="text-sm text-text-muted">{t('dash.sales.targetForPeriod', 'Revenue target for')} {new Date().toISOString().slice(0, 7)}</p>
            <Field label={t('dash.sales.scope', 'Scope')} hint={t('dash.sales.scopeHint', 'Overall is the tenant-wide goal; a branch target is tracked against that branch only.')}>
              <select className="input-field" value={targetScope} onChange={(e) => { setTargetScope(e.target.value); setTargetAmt(String(targetOf(e.target.value) ?? '')); }}>
                <option value={OVERALL}>{t('dash.sales.overallAllBranches', 'Overall (all branches)')}</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label={t('dash.sales.targetAmount', 'Target amount (Rp)')}>
              <input className="input-field" type="number" placeholder="0" value={targetAmt} onChange={(e) => setTargetAmt(e.target.value)} autoFocus />
            </Field>
            {targets && (targets.overall != null || targets.branches.length > 0) && (
              <div className="rounded-lg border border-border bg-surface-sunken/50 p-3 text-sm">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">{t('dash.sales.currentTargets', 'Current targets')}</p>
                <ul className="space-y-1">
                  <li className="flex justify-between"><span className="text-text-secondary">{t('dash.sales.overallAllBranches', 'Overall (all branches)')}</span><span className="tabular-nums text-text-primary">{targets.overall != null ? fmtIDR(targets.overall) : '—'}</span></li>
                  {targets.branches.map((b) => (
                    <li key={b.outletId} className="flex justify-between"><span className="text-text-secondary">{b.outletName}</span><span className="tabular-nums text-text-primary">{fmtIDR(b.targetAmount)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
