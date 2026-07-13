'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { isAuthenticated, getUser } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Modal, Field, ErrorBanner, TableSkeleton, fmtDate } from '@/components/dashboard/ui';

type Severity = 'info' | 'warning' | 'critical';
type Audience = 'all' | 'plan' | 'tenant';
interface Announcement {
  id: string; title: string; body: string; severity: Severity; audience: Audience;
  target: string | null; published: boolean; startsAt: string | null; endsAt: string | null;
  createdAt: string; updatedAt: string;
}
interface TenantLite { id: string; name: string }
interface PlanLite { code: string; name: string }

const SEVERITY_BADGE: Record<Severity, string> = {
  info: 'bg-sky-50 text-sky-700', warning: 'bg-amber-50 text-amber-700', critical: 'bg-rose-50 text-rose-700',
};

function AnnouncementModal({ initial, tenants, plans, onClose, onSaved }: {
  initial: Announcement | null; tenants: TenantLite[]; plans: PlanLite[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    title: initial?.title ?? '', body: initial?.body ?? '',
    severity: initial?.severity ?? 'info' as Severity, audience: initial?.audience ?? 'all' as Audience,
    target: initial?.target ?? '', published: initial?.published ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    const payload = { ...form, target: form.audience === 'all' ? null : form.target };
    try {
      if (initial) await api.put(`/admin/announcements/${initial.id}`, payload);
      else await api.post('/admin/announcements', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.ann.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      title={initial ? t('admin.ann.edit', 'Edit announcement') : t('admin.ann.new', 'New announcement')}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{t('admin.ann.cancel', 'Cancel')}</button>
        <button type="submit" form="ann-form" className="btn-primary" disabled={saving}>{saving ? t('admin.ann.saving', 'Saving…') : initial ? t('admin.ann.update', 'Update') : t('admin.ann.create', 'Create')}</button>
      </>}
    >
      <form id="ann-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label={t('admin.ann.title', 'Title')}><input className="input-field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
        <Field label={t('admin.ann.body', 'Body')}><textarea className="input-field min-h-[100px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.ann.severity', 'Severity')}>
            <select className="input-field" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
              <option value="info">{t('admin.ann.info', 'Info')}</option><option value="warning">{t('admin.ann.warning', 'Warning')}</option><option value="critical">{t('admin.ann.critical', 'Critical')}</option>
            </select>
          </Field>
          <Field label={t('admin.ann.audience', 'Audience')}>
            <select className="input-field" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as Audience, target: '' })}>
              <option value="all">{t('admin.ann.allTenants', 'All tenants')}</option><option value="plan">{t('admin.ann.byPlan', 'By plan')}</option><option value="tenant">{t('admin.ann.oneTenant', 'One tenant')}</option>
            </select>
          </Field>
        </div>
        {form.audience === 'plan' && (
          <Field label={t('admin.ann.plan', 'Plan')}>
            <select className="input-field" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required>
              <option value="">{t('admin.ann.selectPlan', 'Select plan…')}</option>
              {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {form.audience === 'tenant' && (
          <Field label={t('admin.ann.tenant', 'Tenant')}>
            <select className="input-field" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required>
              <option value="">{t('admin.ann.selectTenant', 'Select tenant…')}</option>
              {tenants.map((tn) => <option key={tn.id} value={tn.id}>{tn.name}</option>)}
            </select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> {t('admin.ann.published', 'Published (visible to tenants)')}
        </label>
      </form>
    </Modal>
  );
}

export default function AdminAnnouncementsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Announcement[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Announcement | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await api.get<Announcement[]>('/admin/announcements')); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.ann.failedToLoad', 'Failed to load')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => {
    if (!isAuthenticated()) { window.location.href = '/'; return; }
    if (getUser()?.role !== 'platform_super_admin') { window.location.href = '/admin'; return; }
    api.get<TenantLite[]>('/admin/tenants/enriched').then(setTenants).catch(() => {});
    api.get<{ code: string; name: string; isActive: boolean }[]>('/admin/platform-plans')
      .then((r) => setPlans(r.filter((p) => p.isActive).map((p) => ({ code: p.code, name: p.name })))).catch(() => {});
    load();
  }, [load]);

  const togglePublish = async (a: Announcement) => {
    try { await api.put(`/admin/announcements/${a.id}`, { published: !a.published }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.ann.actionFailed', 'Action failed')); }
  };
  const remove = async () => {
    if (!deleting) return;
    try { await api.delete(`/admin/announcements/${deleting.id}`); setDeleting(null); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.ann.actionFailed', 'Action failed')); setDeleting(null); }
  };

  const audienceLabel = (a: Announcement) => {
    if (a.audience === 'all') return t('admin.ann.allTenants', 'All tenants');
    if (a.audience === 'plan') return `${t('admin.ann.byPlan', 'By plan')}: ${plans.find((p) => p.code === a.target)?.name ?? a.target}`;
    return `${t('admin.ann.oneTenant', 'One tenant')}: ${tenants.find((tn) => tn.id === a.target)?.name ?? a.target}`;
  };

  return (
    <div className="space-y-6" data-testid="admin-announcements">
      <PageHeader
        title={t('admin.ann.pageTitle', 'Announcements')}
        subtitle={t('admin.ann.subtitle', 'Broadcast messages to tenants — platform-wide, to a plan cohort, or to a single tenant.')}
        actions={<button className="btn-primary" onClick={() => setModal({ open: true, editing: null })}>+ {t('admin.ann.new', 'New announcement')}</button>}
      />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {loading ? <Panel bodyClassName="p-0"><TableSkeleton rows={3} cols={2} /></Panel> : items.length === 0 ? (
        <Panel><p className="text-sm text-text-muted">{t('admin.ann.none', 'No announcements yet.')}</p></Panel>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Panel key={a.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-text-primary">{a.title}</h3>
                    <span className={cn('badge capitalize', SEVERITY_BADGE[a.severity])}>{a.severity}</span>
                    <span className={cn('badge', a.published ? 'bg-green-50 text-green-700' : 'bg-surface-sunken text-text-secondary')}>{a.published ? t('admin.ann.publishedBadge', 'Published') : t('admin.ann.draftBadge', 'Draft')}</span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap">{a.body}</p>
                  <p className="text-xs text-text-muted mt-2">{audienceLabel(a)} · {fmtDate(a.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn-ghost text-xs" onClick={() => togglePublish(a)}>{a.published ? t('admin.ann.unpublish', 'Unpublish') : t('admin.ann.publish', 'Publish')}</button>
                  <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: a })}>{t('admin.ann.editBtn', 'Edit')}</button>
                  <button className="btn-ghost text-xs text-rose-600" onClick={() => setDeleting(a)}>{t('admin.ann.delete', 'Delete')}</button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {modal.open && <AnnouncementModal initial={modal.editing} tenants={tenants} plans={plans} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}

      {deleting && (
        <Modal title={t('admin.ann.deleteTitle', 'Delete announcement')} onClose={() => setDeleting(null)} footer={<>
          <button className="btn-secondary" onClick={() => setDeleting(null)}>{t('admin.ann.cancel', 'Cancel')}</button>
          <button className="btn-primary" onClick={remove}>{t('admin.ann.delete', 'Delete')}</button>
        </>}>
          <p className="text-sm text-text-secondary">{t('admin.ann.deleteConfirm', 'Delete "{title}"? This cannot be undone.').replace('{title}', deleting.title)}</p>
        </Modal>
      )}
    </div>
  );
}
