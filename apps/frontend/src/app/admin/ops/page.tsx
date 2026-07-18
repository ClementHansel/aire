'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtDateTime } from '@/components/dashboard/ui';

type Severity = 'critical' | 'warning' | 'info';

interface OpsEvent {
  id: string; at: string; type: string; severity: Severity;
  tenantId: string | null; tenantName: string | null; outletId: string | null;
  actor: string | null; payload: Record<string, unknown> | null;
}
interface Paged { data: OpsEvent[]; total: number; page: number; pageSize: number; totalPages: number }
interface TenantLite { id: string; name: string }

// Dot + subtle badge, coloured by severity: critical=red, warning=amber, info=neutral.
const SEV_DOT: Record<Severity, string> = {
  critical: 'bg-rose-500', warning: 'bg-amber-500', info: 'bg-text-muted',
};
const SEV_BADGE: Record<Severity, string> = {
  critical: 'bg-rose-50 text-rose-700', warning: 'bg-amber-50 text-amber-700', info: 'bg-surface-sunken text-text-secondary',
};

// "tenant.suspended" / "invoice_overdue" -> "Tenant suspended" / "Invoice overdue".
function humanizeType(type: string): string {
  const words = (type || '').replace(/[._]/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—';
}

export default function AdminOpsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<OpsEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [f, setF] = useState({ severity: '' as '' | Severity, tenantId: '', types: '' });

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (getUser()?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    // Seed the severity filter from the URL (?severity=critical) so the overview widget can deep-link.
    const sev = new URLSearchParams(window.location.search).get('severity');
    if (sev === 'critical' || sev === 'warning' || sev === 'info') setF((prev) => ({ ...prev, severity: sev }));
    api.get<TenantLite[]>('/admin/tenants').then(setTenants).catch(() => {});
    // Intentionally run once on mount; the URL seed is a one-time default.
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const qs = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (f.severity) qs.set('severity', f.severity);
    if (f.tenantId) qs.set('tenantId', f.tenantId);
    if (f.types.trim()) qs.set('types', f.types.split(',').map((s) => s.trim()).filter(Boolean).join(','));
    try {
      const r = await api.get<Paged>(`/admin/ops-feed?${qs.toString()}`);
      setRows(r.data); setTotal(r.total); setTotalPages(r.totalPages);
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.ops.failedToLoad', 'Failed to load ops feed')); }
    finally { setLoading(false); }
  }, [page, f, t]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (patch: Partial<typeof f>) => { setPage(1); setF((prev) => ({ ...prev, ...patch })); };
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-6" data-testid="admin-ops">
      <PageHeader
        title={t('admin.ops.title', 'Ops & alert feed')}
        subtitle={t('admin.ops.subtitle', 'A live stream of platform events and alerts across all tenants — filter by severity or tenant and expand any row for its payload.')}
        actions={<button className="btn-secondary text-sm" onClick={load}>↻ {t('admin.ops.refresh', 'Refresh')}</button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className="input-field max-w-[180px]" value={f.severity} onChange={(e) => setFilter({ severity: e.target.value as '' | Severity })} aria-label={t('admin.ops.severity', 'Severity')}>
          <option value="">{t('admin.ops.allSeverities', 'All severities')}</option>
          <option value="critical">{t('admin.ops.critical', 'Critical')}</option>
          <option value="warning">{t('admin.ops.warning', 'Warning')}</option>
          <option value="info">{t('admin.ops.info', 'Info')}</option>
        </select>
        <select className="input-field max-w-[220px]" value={f.tenantId} onChange={(e) => setFilter({ tenantId: e.target.value })} aria-label={t('admin.ops.tenant', 'Tenant')}>
          <option value="">{t('admin.ops.allTenants', 'All tenants')}</option>
          {tenants.map((tn) => <option key={tn.id} value={tn.id}>{tn.name}</option>)}
        </select>
        <input
          className="input-field max-w-[240px]"
          value={f.types}
          onChange={(e) => setFilter({ types: e.target.value })}
          placeholder={t('admin.ops.typesPlaceholder', 'Types (comma-separated)')}
          aria-label={t('admin.ops.types', 'Event types')}
        />
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <Panel bodyClassName="p-0">
        {loading ? <TableSkeleton rows={8} cols={5} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.ops.colSeverity', 'Severity')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.ops.colEvent', 'Event')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.ops.colTenant', 'Tenant')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.ops.colActor', 'Actor')}</th>
                <th className={cn(thCls, 'text-right')}>{t('admin.ops.colTime', 'Time')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <EmptyRow colSpan={5}>{t('admin.ops.noEvents', 'No events match these filters.')}</EmptyRow>
              ) : rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="hover:bg-surface-sunken/50 cursor-pointer" onClick={() => toggle(r.id)}>
                    <td className={tdCls}>
                      <span className="flex items-center gap-2">
                        <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', SEV_DOT[r.severity])} aria-hidden />
                        <span className={cn('badge capitalize', SEV_BADGE[r.severity])}>{r.severity}</span>
                      </span>
                    </td>
                    <td className={cn(tdCls, 'font-medium')}>
                      <span className="flex items-center gap-2">
                        <span className="text-text-muted transition-transform" style={{ display: 'inline-block', transform: expanded.has(r.id) ? 'rotate(90deg)' : 'none' }} aria-hidden>›</span>
                        {humanizeType(r.type)}
                        <span className="font-mono text-xs text-text-muted font-normal">{r.type}</span>
                      </span>
                    </td>
                    <td className={tdCls}>
                      {r.tenantId ? (
                        <Link href={`/admin/tenants/${r.tenantId}`} className="text-primary-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.tenantName ?? r.tenantId.slice(0, 8)}
                        </Link>
                      ) : <span className="text-text-muted">—</span>}
                    </td>
                    <td className={cn(tdCls, 'text-text-muted')}>{r.actor ?? '—'}</td>
                    <td className={cn(tdCls, 'text-right whitespace-nowrap text-xs text-text-muted')}>{fmtDateTime(r.at)}</td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr className="bg-surface-sunken/30">
                      <td colSpan={5} className="px-5 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">{t('admin.ops.payload', 'Payload')}</p>
                        <pre className="text-xs bg-surface-sunken rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap break-words">{r.payload && Object.keys(r.payload).length > 0 ? JSON.stringify(r.payload, null, 2) : t('admin.ops.noPayload', 'No payload.')}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div className="flex items-center justify-between text-sm">
        <span className="text-text-muted">{t('admin.ops.total', '{n} events').replace('{n}', total.toLocaleString('id-ID'))}</span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← {t('admin.ops.prev', 'Prev')}</button>
          <span className="text-text-muted">{page} / {totalPages || 1}</span>
          <button className="btn-secondary text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t('admin.ops.next', 'Next')} →</button>
        </div>
      </div>
    </div>
  );
}
