'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { PageHeader, StatCard, Panel, ErrorBanner } from '@/components/dashboard/ui';
import { BarChart } from '@/components/admin/charts';

type Scope = 'global' | 'tenant' | 'branch';
interface TenantLite { id: string; name: string }
interface BranchLite { id: string; name: string }
interface AiUsage {
  totals: { calls: number; ok: number; errors: number; prompt_tokens: number; completion_tokens: number; avg_ms: number; estimated_cost_usd: number };
  byKind: { kind: string; n: number }[];
  series: { day: string; n: number }[];
  byTenant: { tenantId: string; name: string; calls: number }[];
}

export default function AdminAiUsagePage() {
  const { t } = useI18n();
  const isSuper = getUser()?.role === 'platform_super_admin';
  const myTenant = getUser()?.tenantId ?? '';
  const [scope, setScope] = useState<Scope>(isSuper ? 'global' : 'tenant');
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [tenantId, setTenantId] = useState(isSuper ? '' : myTenant);
  const [outletId, setOutletId] = useState('');
  const [days, setDays] = useState('30');
  const [data, setData] = useState<AiUsage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (isSuper) api.get<TenantLite[]>('/admin/tenants/enriched').then(setTenants).catch(() => {});
  }, [isSuper]);
  useEffect(() => {
    if (scope !== 'global' && tenantId) api.get<BranchLite[]>(`/admin/tenants/${tenantId}/branches`).then(setBranches).catch(() => setBranches([]));
  }, [scope, tenantId]);

  const load = useCallback(async () => {
    setError('');
    const qs = new URLSearchParams({ scope, days });
    if (scope !== 'global' && tenantId) qs.set('tenantId', tenantId);
    if (scope === 'branch' && outletId) qs.set('outletId', outletId);
    try { setData(await api.get<AiUsage>(`/admin/ai-usage?${qs.toString()}`)); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.aiUsage.failedToLoad', 'Failed to load')); }
  }, [scope, tenantId, outletId, days, t]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="admin-ai-usage">
      <PageHeader
        title={t('admin.aiUsage.title', 'AI Usage')}
        subtitle={t('admin.aiUsage.subtitle', 'LLM & agent invocations (calls, tokens, errors). Branch-level appears once AI events are attributed to an outlet.')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className="input-field max-w-[180px]" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setOutletId(''); }}>
          {isSuper && <option value="global">{t('admin.aiUsage.scopeGlobal', 'Global (all tenants)')}</option>}
          <option value="tenant">{isSuper ? t('admin.aiUsage.scopePerTenant', 'Per tenant') : t('admin.aiUsage.scopeMyBusiness', 'My business')}</option>
          <option value="branch">{t('admin.aiUsage.scopePerBranch', 'Per branch')}</option>
        </select>
        {isSuper && scope !== 'global' && (
          <select className="input-field max-w-[220px]" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOutletId(''); }}>
            <option value="">{t('admin.aiUsage.selectTenant', 'Select tenant…')}</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        )}
        {scope === 'branch' && tenantId && (
          <select className="input-field max-w-[220px]" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">{t('admin.aiUsage.selectBranch', 'Select branch…')}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select className="input-field max-w-[120px]" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">{t('admin.aiUsage.days7', '7 days')}</option><option value="30">{t('admin.aiUsage.days30', '30 days')}</option><option value="90">{t('admin.aiUsage.days90', '90 days')}</option>
        </select>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {scope !== 'global' && !tenantId ? (
        <p className="text-text-muted">{t('admin.aiUsage.selectTenantUsage', 'Select a tenant to view usage.')}</p>
      ) : data ? (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <StatCard label={t('admin.aiUsage.calls', 'Calls')} value={data.totals.calls.toLocaleString('id-ID')} />
            <StatCard label={t('admin.aiUsage.successError', 'Success / Error')} value={<>{data.totals.ok} / <span className="text-rose-600">{data.totals.errors}</span></>} />
            <StatCard label={t('admin.aiUsage.promptTokens', 'Prompt tokens')} value={data.totals.prompt_tokens.toLocaleString('id-ID')} />
            <StatCard label={t('admin.aiUsage.completionTokens', 'Completion tokens')} value={data.totals.completion_tokens.toLocaleString('id-ID')} />
            <StatCard label={t('admin.aiUsage.estCost', 'Est. cost (USD)')} value={`$${(data.totals.estimated_cost_usd ?? 0).toFixed(2)}`} tone="primary" />
            <StatCard label={t('admin.aiUsage.avgLatency', 'Avg latency')} value={`${data.totals.avg_ms} ms`} />
          </section>

          <div className="grid lg:grid-cols-3 gap-4">
            <Panel title={t('admin.aiUsage.callsPerDay', 'Calls / day')} className="lg:col-span-2">
              <BarChart data={data.series.map((d) => ({ label: d.day, value: d.n }))} color="var(--color-primary-500, #7c3aed)" empty={t('admin.aiUsage.noData', 'No data.')} />
            </Panel>
            <Panel title={t('admin.aiUsage.byKind', 'By kind')}>
              {data.byKind.length === 0 ? <p className="text-sm text-text-muted">{t('admin.aiUsage.noData', 'No data.')}</p> : (
                <ul className="space-y-1.5 text-sm">{data.byKind.map((k) => <li key={k.kind} className="flex justify-between"><span className="capitalize">{k.kind}</span><span className="font-medium tabular-nums">{k.n}</span></li>)}</ul>
              )}
            </Panel>
          </div>

          {scope === 'global' && data.byTenant.length > 0 && (
            <Panel title={t('admin.aiUsage.topTenants', 'Top tenants by AI calls')}>
              <ul className="divide-y divide-border -my-2">
                {data.byTenant.map((tenant) => <li key={tenant.tenantId} className="py-2 flex justify-between text-sm"><span>{tenant.name}</span><span className="font-medium tabular-nums">{tenant.calls.toLocaleString('id-ID')}</span></li>)}
              </ul>
            </Panel>
          )}
        </>
      ) : <p className="text-text-muted">{t('admin.aiUsage.loading', 'Loading…')}</p>}
    </div>
  );
}
