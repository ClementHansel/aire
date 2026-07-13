'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Modal, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtDateTime } from '@/components/dashboard/ui';

interface AuditRow {
  id: string; at: string; operation: string; entityType: string; entityId: string | null;
  beforeValue: unknown; afterValue: unknown; metadata: Record<string, unknown>; ipAddress: string | null;
  tenantId: string | null; tenantName: string | null; userId: string | null; userName: string | null;
}
interface Paged { data: AuditRow[]; total: number; page: number; pageSize: number; totalPages: number }
interface TenantLite { id: string; name: string }

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">{label}</p>
      <pre className="text-xs bg-surface-sunken rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default function AdminAuditPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [f, setF] = useState({ tenantId: '', operation: '', entityType: '', dateFrom: '', dateTo: '' });

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (getUser()?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    api.get<TenantLite[]>('/admin/tenants/enriched').then(setTenants).catch(() => {});
    api.get<{ operations: string[]; entityTypes: string[] }>('/admin/audit/filters')
      .then((r) => { setOperations(r.operations); setEntityTypes(r.entityTypes); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const qs = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (f.tenantId) qs.set('tenantId', f.tenantId);
    if (f.operation) qs.set('operation', f.operation);
    if (f.entityType) qs.set('entityType', f.entityType);
    if (f.dateFrom) qs.set('dateFrom', f.dateFrom);
    if (f.dateTo) qs.set('dateTo', f.dateTo);
    try {
      const r = await api.get<Paged>(`/admin/audit?${qs.toString()}`);
      setRows(r.data); setTotal(r.total); setTotalPages(r.totalPages);
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.audit.failedToLoad', 'Failed to load audit log')); }
    finally { setLoading(false); }
  }, [page, f, t]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (patch: Partial<typeof f>) => { setPage(1); setF((prev) => ({ ...prev, ...patch })); };

  return (
    <div className="space-y-6" data-testid="admin-audit">
      <PageHeader
        title={t('admin.audit.title', 'Audit Log')}
        subtitle={t('admin.audit.subtitle', 'Every security-relevant action across all tenants — who did what, when, and the before/after values.')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className="input-field max-w-[220px]" value={f.tenantId} onChange={(e) => setFilter({ tenantId: e.target.value })}>
          <option value="">{t('admin.audit.allTenants', 'All tenants')}</option>
          {tenants.map((tn) => <option key={tn.id} value={tn.id}>{tn.name}</option>)}
        </select>
        <select className="input-field max-w-[200px]" value={f.operation} onChange={(e) => setFilter({ operation: e.target.value })}>
          <option value="">{t('admin.audit.allOperations', 'All operations')}</option>
          {operations.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input-field max-w-[200px]" value={f.entityType} onChange={(e) => setFilter({ entityType: e.target.value })}>
          <option value="">{t('admin.audit.allEntities', 'All entities')}</option>
          {entityTypes.map((en) => <option key={en} value={en}>{en.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="date" className="input-field max-w-[160px]" value={f.dateFrom} onChange={(e) => setFilter({ dateFrom: e.target.value })} aria-label={t('admin.audit.from', 'From')} />
        <input type="date" className="input-field max-w-[160px]" value={f.dateTo} onChange={(e) => setFilter({ dateTo: e.target.value })} aria-label={t('admin.audit.to', 'To')} />
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <Panel bodyClassName="p-0">
        {loading ? <TableSkeleton rows={8} cols={5} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.audit.colTime', 'Time')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.audit.colTenant', 'Tenant')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.audit.colUser', 'User')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.audit.colOperation', 'Operation')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.audit.colEntity', 'Entity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <EmptyRow colSpan={5}>{t('admin.audit.noEntries', 'No audit entries match these filters.')}</EmptyRow>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-sunken/50 cursor-pointer" onClick={() => setDetail(r)}>
                  <td className={cn(tdCls, 'whitespace-nowrap text-xs text-text-muted')}>{fmtDateTime(r.at)}</td>
                  <td className={tdCls}>{r.tenantName ?? <span className="text-text-muted">—</span>}</td>
                  <td className={tdCls}>{r.userName ?? <span className="text-text-muted font-mono text-xs">{r.userId?.slice(0, 8) ?? '—'}</span>}</td>
                  <td className={tdCls}><span className="badge bg-surface-sunken text-text-secondary capitalize">{r.operation.replace(/_/g, ' ')}</span></td>
                  <td className={cn(tdCls, 'text-text-muted')}>{r.entityType.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <div className="flex items-center justify-between text-sm">
        <span className="text-text-muted">{t('admin.audit.total', '{n} entries').replace('{n}', total.toLocaleString('id-ID'))}</span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← {t('admin.audit.prev', 'Prev')}</button>
          <span className="text-text-muted">{page} / {totalPages || 1}</span>
          <button className="btn-secondary text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t('admin.audit.next', 'Next')} →</button>
        </div>
      </div>

      {detail && (
        <Modal title={`${detail.operation.replace(/_/g, ' ')} · ${detail.entityType}`} onClose={() => setDetail(null)} maxWidth="max-w-2xl">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-text-muted">{t('admin.audit.colTenant', 'Tenant')}</p><p className="font-medium">{detail.tenantName ?? '—'}</p></div>
              <div><p className="text-xs text-text-muted">{t('admin.audit.colUser', 'User')}</p><p className="font-medium">{detail.userName ?? detail.userId ?? '—'}</p></div>
              <div><p className="text-xs text-text-muted">{t('admin.audit.time', 'Time')}</p><p className="font-medium">{fmtDateTime(detail.at)}</p></div>
              <div><p className="text-xs text-text-muted">{t('admin.audit.ip', 'IP address')}</p><p className="font-medium font-mono">{detail.ipAddress ?? '—'}</p></div>
              {detail.entityId && <div className="col-span-2"><p className="text-xs text-text-muted">{t('admin.audit.entityId', 'Entity ID')}</p><p className="font-medium font-mono text-xs break-all">{detail.entityId}</p></div>}
            </div>
            <JsonBlock label={t('admin.audit.before', 'Before')} value={detail.beforeValue} />
            <JsonBlock label={t('admin.audit.after', 'After')} value={detail.afterValue} />
            {detail.metadata && Object.keys(detail.metadata).length > 0 && <JsonBlock label={t('admin.audit.metadata', 'Metadata')} value={detail.metadata} />}
          </div>
        </Modal>
      )}
    </div>
  );
}
