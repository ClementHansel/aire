'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isAuthenticated, getUser, logout } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, StatCard, Panel, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls } from '@/components/dashboard/ui';

type TenantStatus = 'active' | 'suspended' | 'cancelled';
interface Tenant { id: string; name: string; slug: string; plan: string; status: TenantStatus; createdAt: string }

const STATUS_BADGE: Record<TenantStatus, string> = {
  active: 'bg-green-50 text-green-700', suspended: 'bg-amber-50 text-amber-700', cancelled: 'bg-rose-50 text-rose-700',
};

export default function AdminSupportPage() {
  const { t } = useI18n();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setTenants(await api.get<Tenant[]>('/admin/tenants')); }
    catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.support.failedToLoad', 'Failed to load tenants');
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) setForbidden(true);
      else setError(msg);
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (err) { setError(err instanceof Error ? err.message : t('admin.support.actionFailed', 'Action failed')); }
  };

  if (forbidden) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-bold text-text-primary mb-2">{t('admin.support.accessDenied', 'Access Denied')}</h1>
        <p className="text-sm text-text-secondary">{t('admin.support.accessDeniedDesc', 'This area requires a Platform Super Admin account. You are signed in as ')}<span className="font-medium">{getUser()?.role?.replace(/_/g, ' ')}</span>.</p>
        <button onClick={logout} className="btn-secondary mt-4">{t('admin.support.signInDifferent', 'Sign in as different user')}</button>
      </div>
    );
  }

  const needsAttention = tenants.filter((tenant) => tenant.status !== 'active');
  const filtered = tenants.filter((tenant) =>
    !query.trim() || tenant.name.toLowerCase().includes(query.toLowerCase()) || tenant.slug.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-6" data-testid="admin-support">
      <PageHeader
        title={t('admin.support.title', 'Support')}
        subtitle={t('admin.support.subtitle', 'Find any tenant and act on the ones that need attention.')}
        actions={<button className="btn-secondary text-sm" onClick={load}>↻ {t('admin.support.refresh', 'Refresh')}</button>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('admin.support.totalTenants', 'Total tenants')} value={String(tenants.length)} loading={loading} />
        <StatCard label={t('admin.support.active', 'Active')} value={String(tenants.filter((tenant) => tenant.status === 'active').length)} tone="positive" loading={loading} />
        <StatCard label={t('admin.support.needsAttention', 'Needs attention')} value={String(needsAttention.length)} tone="warning" loading={loading} />
      </div>

      {needsAttention.length > 0 && (
        <Panel title={t('admin.support.needsAttention', 'Needs attention')}>
          <div className="space-y-2">
            {needsAttention.map((tenant) => (
              <div key={tenant.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2.5">
                <div>
                  <Link href={`/admin/tenants/${tenant.slug}`} className="text-sm font-medium text-primary-600 hover:underline">{tenant.name}</Link>
                  <p className="text-xs text-text-muted">{tenant.slug} · {tenant.plan}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn('badge capitalize', STATUS_BADGE[tenant.status])}>{tenant.status}</span>
                  {tenant.status === 'suspended' && <button className="btn-ghost text-xs text-green-600" onClick={() => act(() => api.patch(`/admin/tenants/${tenant.id}/reactivate`))}>{t('admin.support.reactivate', 'Reactivate')}</button>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <input className="input-field max-w-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.support.searchPlaceholder', 'Search tenants by name or slug…')} />

      <Panel bodyClassName="p-0">
        {loading ? <TableSkeleton rows={5} cols={4} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                <th className={cn(thCls, 'text-left')}>{t('admin.support.colTenant', 'Tenant')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.support.colPlan', 'Plan')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.support.colStatus', 'Status')}</th>
                <th className={cn(thCls, 'text-left')}>{t('admin.support.colTenantId', 'Tenant ID')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <EmptyRow colSpan={4}>{t('admin.support.noMatching', 'No matching tenants.')}</EmptyRow>
              ) : filtered.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-surface-sunken/50">
                  <td className={cn(tdCls, 'font-medium')}><Link href={`/admin/tenants/${tenant.slug}`} className="text-primary-600 hover:underline">{tenant.name}</Link><span className="text-text-muted"> · {tenant.slug}</span></td>
                  <td className={cn(tdCls, 'capitalize')}>{tenant.plan}</td>
                  <td className={tdCls}><span className={cn('badge capitalize', STATUS_BADGE[tenant.status])}>{tenant.status}</span></td>
                  <td className={cn(tdCls, 'text-xs text-text-muted font-mono')}>{tenant.id}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
