'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, StatCard, Panel, Modal, ErrorBanner, TableWrap, TableSkeleton, thCls, tdCls, fmtDateTime } from '@/components/dashboard/ui';

interface Health {
  db: { ok: boolean; latencyMs: number };
  waha: { ok: boolean; status: string };
  counts: { tenants: number; outlets: number; orders: number; agents: number };
  checkedAt: string;
}
interface ContainerInfo {
  id: string; name: string; image: string; state: string; status: string;
  health: 'healthy' | 'unhealthy' | 'starting' | null;
}
interface ContainersResp { available: boolean; containers: ContainerInfo[] }

function Pill({ ok }: { ok: boolean }) {
  const { t } = useI18n();
  return <span className={cn('badge', ok ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700')}>{ok ? t('admin.health.healthy', '● Healthy') : t('admin.health.down', '● Down')}</span>;
}

const STATE_BADGE = (state: string) =>
  state === 'running' ? 'bg-green-50 text-green-700'
    : state === 'restarting' || state === 'paused' ? 'bg-amber-50 text-amber-700'
      : 'bg-rose-50 text-rose-700';

function LogsModal({ container, onClose }: { container: ContainerInfo; onClose: () => void }) {
  const { t } = useI18n();
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetchLogs = useCallback(async () => {
    setLoading(true); setError('');
    try { setLogs((await api.get<{ logs: string }>(`/admin/health/containers/${container.id}/logs?tail=300`)).logs || '(no output)'); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.health.logsFailed', 'Failed to load logs')); }
    finally { setLoading(false); }
  }, [container.id, t]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <Modal
      title={`${t('admin.health.logsFor', 'Logs')}: ${container.name}`}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={<button className="btn-secondary text-xs" onClick={fetchLogs}>↻ {t('admin.health.refresh', 'Refresh')}</button>}
    >
      <div className="overflow-auto rounded-lg bg-[#0b1020] p-4 max-h-[60vh]">
        {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
        {loading ? <p className="text-xs text-gray-400">{t('admin.health.loadingLogs', 'Loading logs…')}</p> : (
          <pre className="text-xs text-gray-200 whitespace-pre-wrap break-words font-mono leading-relaxed">{logs}</pre>
        )}
      </div>
    </Modal>
  );
}

export default function AdminHealthPage() {
  const { t } = useI18n();
  const [h, setH] = useState<Health | null>(null);
  const [containers, setContainers] = useState<ContainersResp | null>(null);
  const [logsFor, setLogsFor] = useState<ContainerInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [health, cont] = await Promise.all([
        api.get<Health>('/admin/health'),
        api.get<ContainersResp>('/admin/health/containers').catch(() => ({ available: false, containers: [] })),
      ]);
      setH(health);
      setContainers(cont);
    }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.health.failedToLoad', 'Failed to load')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="admin-health">
      <PageHeader
        title={t('admin.health.title', 'System Health')}
        subtitle={t('admin.health.subtitle', 'Database, messaging gateway, and container status for the platform.')}
        actions={<button className="btn-secondary text-sm" onClick={load}>↻ {t('admin.health.refresh', 'Refresh')}</button>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {loading || !h ? <TableSkeleton rows={4} cols={2} /> : (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <Panel title={<span className="flex items-center gap-2">{t('admin.health.database', 'Database')} <Pill ok={h.db.ok} /></span>}>
              <p className="text-sm text-text-muted">{t('admin.health.queryLatency', 'Query latency:')} <span className="font-medium text-text-primary">{h.db.latencyMs} ms</span></p>
            </Panel>
            <Panel title={<span className="flex items-center gap-2">{t('admin.health.whatsappGateway', 'WhatsApp gateway (WAHA)')} <Pill ok={h.waha.ok} /></span>}>
              <p className="text-sm text-text-muted">{t('admin.health.status', 'Status:')} <span className="font-medium text-text-primary">{h.waha.status}</span></p>
            </Panel>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={t('admin.health.tenants', 'Tenants')} value={String(h.counts.tenants)} />
            <StatCard label={t('admin.health.outlets', 'Outlets')} value={String(h.counts.outlets)} />
            <StatCard label={t('admin.health.ordersAllTime', 'Orders (all-time)')} value={h.counts.orders.toLocaleString('id-ID')} />
            <StatCard label={t('admin.health.agents', 'Agents')} value={String(h.counts.agents)} />
          </div>

          <Panel title={t('admin.health.containers', 'Containers')} bodyClassName={containers?.available && containers.containers.length > 0 ? 'p-0' : 'p-5'}>
            {!containers?.available ? (
              <p className="text-sm text-text-muted">{t('admin.health.dockerUnavailable', 'Docker socket not available on this host — container status and logs are hidden.')}</p>
            ) : containers.containers.length === 0 ? (
              <p className="text-sm text-text-muted">{t('admin.health.noContainers', 'No containers found.')}</p>
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border">
                    {[t('admin.health.colContainer', 'Container'), t('admin.health.colImage', 'Image'), t('admin.health.colState', 'State'), t('admin.health.colStatus', 'Status'), ''].map((c, i) => (
                      <th key={i} className={cn(thCls, 'text-left whitespace-nowrap')}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {containers.containers.map((c) => (
                    <tr key={c.id} className="hover:bg-surface-sunken/50">
                      <td className={cn(tdCls, 'font-medium font-mono')}>{c.name}</td>
                      <td className={cn(tdCls, 'text-xs text-text-muted max-w-[220px] truncate')} title={c.image}>{c.image}</td>
                      <td className={tdCls}>
                        <span className={cn('badge capitalize', STATE_BADGE(c.state))}>{c.state}</span>
                        {c.health && <span className={cn('badge ml-1', c.health === 'healthy' ? 'bg-green-50 text-green-700' : c.health === 'starting' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')}>{c.health}</span>}
                      </td>
                      <td className={cn(tdCls, 'text-xs text-text-muted whitespace-nowrap')}>{c.status}</td>
                      <td className={cn(tdCls, 'text-right')}><button className="btn-ghost text-xs" onClick={() => setLogsFor(c)}>{t('admin.health.viewLogs', 'Logs')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>

          <p className="text-xs text-text-muted">{t('admin.health.checkedAt', 'Checked at')} {fmtDateTime(h.checkedAt)}.</p>
        </>
      )}

      {logsFor && <LogsModal container={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}
