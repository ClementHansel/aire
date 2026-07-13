'use client';

/**
 * Audit log viewer (tenant-owner). Read-only view over /api/audit-logs with
 * operation / entity / date filters + pagination, and a drawer showing the
 * before/after JSON of each change (e.g. order.void reasons, shift open reasons).
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHeader, Panel, TableWrap, thCls, tdCls, EmptyRow, fmtDateTime, Modal } from '@/components/dashboard/ui';

interface AuditRow {
  id: string;
  operation: string;
  entityType: string;
  entityId: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  createdAt: string;
}
interface AuditResponse { data: AuditRow[]; total: number; page: number; pageSize: number; totalPages: number }

const opBadge = (op: string) =>
  op.includes('void') || op.includes('delete') ? 'bg-rose-50 text-rose-700'
    : op.includes('open') || op.includes('create') ? 'bg-emerald-50 text-emerald-700'
    : 'bg-surface-sunken text-text-secondary';

export default function AuditPage() {
  const { t } = useI18n();
  const [resp, setResp] = useState<AuditResponse | null>(null);
  const [operation, setOperation] = useState('');
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (operation.trim()) qs.set('operation', operation.trim());
      if (entityType.trim()) qs.set('entityType', entityType.trim());
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      setResp(await api.get<AuditResponse>(`/audit-logs?${qs.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.audit.failLoad', 'Failed to load audit logs')); }
    finally { setLoading(false); }
  }, [operation, entityType, dateFrom, dateTo, page]);
  useEffect(() => { load(); }, [load]);

  const rows = resp?.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('dash.audit.title', 'Audit Log')}
        subtitle={t('dash.audit.subtitle', 'Every security-relevant change in your business — voids, cancellations, shift openings, edits — with who, when, and before/after values.')}
      />

      <Panel bodyClassName="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.audit.operation', 'Operation')}</label>
            <input className="input-field py-1.5" placeholder="order.void" value={operation} onChange={(e) => { setPage(1); setOperation(e.target.value); }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.audit.entity', 'Entity')}</label>
            <input className="input-field py-1.5" placeholder="order" value={entityType} onChange={(e) => { setPage(1); setEntityType(e.target.value); }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.audit.from', 'From')}</label>
            <input type="date" className="input-field py-1.5" value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value); }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('dash.audit.to', 'To')}</label>
            <input type="date" className="input-field py-1.5" value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value); }} />
          </div>
        </div>
      </Panel>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <Panel bodyClassName="p-0">
        <TableWrap>
          <thead className="bg-surface-sunken/50 border-b border-border">
            <tr>
              <th className={`${thCls} text-left`}>{t('dash.audit.time', 'Time')}</th>
              <th className={`${thCls} text-left`}>{t('dash.audit.operation', 'Operation')}</th>
              <th className={`${thCls} text-left`}>{t('dash.audit.entity', 'Entity')}</th>
              <th className={`${thCls} text-left`}>{t('dash.audit.user', 'User')}</th>
              <th className={`${thCls} text-left`}>{t('dash.audit.ip', 'IP address')}</th>
              <th className={`${thCls} text-right`}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <EmptyRow colSpan={6}>{t('dash.audit.loading', 'Loading…')}</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>{t('dash.audit.none', 'No audit entries match those filters.')}</EmptyRow>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-sunken/40">
                <td className={`${tdCls} whitespace-nowrap`}>{fmtDateTime(r.createdAt)}</td>
                <td className={tdCls}><span className={`badge ${opBadge(r.operation)}`}>{r.operation}</span></td>
                <td className={tdCls}>{r.entityType}{r.entityId ? <span className="text-text-muted"> · {r.entityId.slice(0, 8)}</span> : ''}</td>
                <td className={tdCls}>
                  {r.userName || r.userEmail ? (
                    <>
                      <span className="text-text-primary">{r.userName ?? r.userEmail}</span>
                      {r.userName && r.userEmail && <span className="block text-xs text-text-muted">{r.userEmail}</span>}
                    </>
                  ) : r.userId ? (
                    <span className="font-mono text-xs text-text-muted">{r.userId.slice(0, 8)}</span>
                  ) : (
                    <span className="text-xs text-text-muted">{t('dash.audit.system', 'System')}</span>
                  )}
                </td>
                <td className={`${tdCls} font-mono text-xs text-text-muted`}>{r.ipAddress ?? '—'}</td>
                <td className={`${tdCls} text-right`}>
                  <button className="btn-ghost text-xs" onClick={() => setDetail(r)}>{t('dash.audit.view', 'View')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      {resp && resp.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span>{t('dash.audit.pageOf', 'Page')} {resp.page} / {resp.totalPages} · {resp.total} {t('dash.audit.entries', 'entries')}</span>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('dash.audit.prev', 'Previous')}</button>
            <button className="btn-secondary text-xs" disabled={page >= resp.totalPages} onClick={() => setPage((p) => p + 1)}>{t('dash.audit.next', 'Next')}</button>
          </div>
        </div>
      )}

      {detail && (
        <Modal title={detail.operation} onClose={() => setDetail(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-text-muted">{fmtDateTime(detail.createdAt)} · {detail.entityType}{detail.entityId ? ` · ${detail.entityId}` : ''}</p>
            <p className="text-text-muted">{t('dash.audit.user', 'User')}: <span className="text-text-primary">{detail.userName ?? detail.userEmail ?? (detail.userId ? detail.userId : t('dash.audit.system', 'System'))}</span>{detail.ipAddress ? <span> · {t('dash.audit.ip', 'IP address')}: <span className="font-mono text-text-primary">{detail.ipAddress}</span></span> : ''}</p>
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">{t('dash.audit.before', 'Before')}</p>
              <pre className="bg-surface-sunken rounded-lg p-3 text-xs overflow-x-auto">{JSON.stringify(detail.beforeValue ?? null, null, 2)}</pre>
            </div>
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">{t('dash.audit.after', 'After')}</p>
              <pre className="bg-surface-sunken rounded-lg p-3 text-xs overflow-x-auto">{JSON.stringify(detail.afterValue ?? null, null, 2)}</pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
