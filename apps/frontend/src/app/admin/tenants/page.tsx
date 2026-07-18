'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { TENANT_MODULES } from '@aire/shared';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Modal, Field, ErrorBanner, TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtIDR, fmtDate } from '@/components/dashboard/ui';
import { StepIndicator } from '@/components/onboarding/StepIndicator';
import { LegalEntityFields, BranchFields, EMPTY_LEGAL, EMPTY_BRANCH, type LegalEntityInput, type BranchInput } from '@/components/onboarding/fields';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

type TenantStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';
interface Tenant {
  id: string; name: string; slug: string; plan: string; status: TenantStatus;
  outlets: number; users: number; orders30d: number; revenue30d: number; lastOrderAt: string | null;
}
const STATUS_BADGE: Record<TenantStatus, string> = {
  active: 'bg-green-50 text-green-700', past_due: 'bg-amber-50 text-amber-700', suspended: 'bg-amber-50 text-amber-700', cancelled: 'bg-rose-50 text-rose-700',
};

function TenantModal({ initial, onClose, onSaved }: { initial: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: initial?.name ?? '', slug: initial?.slug ?? '', plan: initial?.plan ?? 'standard' });
  const [planOptions, setPlanOptions] = useState<{ code: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Plan choices come from the platform subscription-plan catalog (/admin/plans).
  useEffect(() => {
    api.get<{ code: string; name: string; isActive: boolean }[]>('/admin/platform-plans')
      .then((rows) => setPlanOptions(rows.filter((p) => p.isActive).map((p) => ({ code: p.code, name: p.name }))))
      .catch(() => setPlanOptions([]));
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (initial) await api.put(`/admin/tenants/${initial.id}`, form);
      else await api.post('/admin/tenants', form);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.tenants.saveFailed', 'Save failed')); } finally { setSaving(false); }
  };
  return (
    <Modal
      title={initial ? t('admin.tenants.editTenant', 'Edit Tenant') : t('admin.tenants.createTenant', 'Create Tenant')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('admin.tenants.cancel', 'Cancel')}</button>
          <button type="submit" form="tenant-form" className="btn-primary" disabled={saving}>{saving ? t('admin.tenants.saving', 'Saving…') : initial ? t('admin.tenants.update', 'Update') : t('admin.tenants.create', 'Create')}</button>
        </>
      }
    >
      <form id="tenant-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label={t('admin.tenants.name', 'Name')}><input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label={t('admin.tenants.slug', 'Slug')}><input className="input-field" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required /></Field>
        <Field label={t('admin.tenants.plan', 'Plan')}>
          <select className="input-field" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
            {planOptions.length === 0 ? (
              <>
                <option value="standard">Standard</option><option value="premium">Premium</option><option value="enterprise">Enterprise</option>
              </>
            ) : (
              planOptions.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)
            )}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Multi-step create-tenant wizard for the platform admin: provisions the tenant
 * + owner login (so they can sign in) and optionally pre-fills modules, the
 * legal entity, and the first branch. Submits once to POST /admin/tenants; the
 * owner then finishes the remaining onboarding steps on their side.
 */
function CreateTenantWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [account, setAccount] = useState({ name: '', slug: '', plan: 'standard', ownerName: '', ownerEmail: '', ownerPassword: '' });
  const [planOptions, setPlanOptions] = useState<{ code: string; name: string }[]>([]);
  const [modules, setModules] = useState<Record<string, boolean>>(() => Object.fromEntries(TENANT_MODULES.map((m) => [m.key, true])));
  const [legal, setLegal] = useState<LegalEntityInput>(EMPTY_LEGAL);
  const [branch, setBranch] = useState<BranchInput>(EMPTY_BRANCH);

  useEffect(() => {
    api.get<{ code: string; name: string; isActive: boolean }[]>('/admin/platform-plans')
      .then((rows) => setPlanOptions(rows.filter((p) => p.isActive).map((p) => ({ code: p.code, name: p.name }))))
      .catch(() => setPlanOptions([]));
  }, []);

  const setName = (name: string) => setAccount((a) => ({ ...a, name, slug: slugTouched ? a.slug : slugify(name) }));
  const LABELS = [t('admin.wiz.account', 'Account'), t('admin.wiz.modules', 'Modules'), t('admin.wiz.legal', 'Legal'), t('admin.wiz.branch', 'Branch')];
  const accountValid = account.name.trim() && account.slug.trim() && account.ownerName.trim() && account.ownerEmail.trim() && account.ownerPassword.length >= 8;

  const create = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/admin/tenants', {
        name: account.name, slug: account.slug, plan: account.plan, modules,
        owner: { name: account.ownerName, email: account.ownerEmail, password: account.ownerPassword },
        legalEntity: legal.name.trim() ? { name: legal.name, npwp: legal.npwp || undefined, address: legal.address || undefined, phone: legal.phone || undefined } : undefined,
        branch: branch.name.trim() ? {
          name: branch.name, code: branch.code || undefined, address: branch.address || undefined, phone: branch.phone || undefined,
          serviceChargePct: branch.serviceChargePct ? Number(branch.serviceChargePct) : undefined,
          taxPct: branch.taxPct ? Number(branch.taxPct) : undefined,
        } : undefined,
      });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('admin.tenants.saveFailed', 'Save failed')); }
    finally { setSaving(false); }
  };

  const footer = (
    <>
      {step > 1 && <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>{t('onboarding.back', 'Back')}</button>}
      {step < 4 && <button type="button" className="btn-primary" disabled={step === 1 && !accountValid} onClick={() => setStep(step + 1)}>{t('onboarding.continue', 'Continue')}</button>}
      {step === 4 && <button type="button" className="btn-primary" disabled={saving || !accountValid} onClick={create}>{saving ? t('admin.tenants.saving', 'Saving…') : t('admin.wiz.createTenant', 'Create tenant')}</button>}
    </>
  );

  return (
    <Modal title={t('admin.wiz.title', 'New tenant')} onClose={onClose} footer={footer} maxWidth="max-w-xl">
      <StepIndicator labels={LABELS} step={step} />
      <ErrorBanner message={error} />

      {step === 1 && (
        <div className="space-y-4">
          <Field label={t('admin.tenants.name', 'Business name')}><input className="input-field" value={account.name} onChange={(e) => setName(e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('admin.tenants.slug', 'Slug')}><input className="input-field" value={account.slug} onChange={(e) => { setSlugTouched(true); setAccount({ ...account, slug: slugify(e.target.value) }); }} required /></Field>
            <Field label={t('admin.tenants.plan', 'Plan')}>
              <select className="input-field" value={account.plan} onChange={(e) => setAccount({ ...account, plan: e.target.value })}>
                {planOptions.length === 0 ? (<><option value="standard">Standard</option><option value="premium">Premium</option><option value="enterprise">Enterprise</option></>) : planOptions.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium text-text-primary mb-2">{t('admin.wiz.ownerLogin', 'Owner login')}</p>
            <div className="space-y-3">
              <Field label={t('admin.wiz.ownerName', 'Owner name')}><input className="input-field" value={account.ownerName} onChange={(e) => setAccount({ ...account, ownerName: e.target.value })} required /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('admin.wiz.ownerEmail', 'Owner email')}><input className="input-field" type="email" value={account.ownerEmail} onChange={(e) => setAccount({ ...account, ownerEmail: e.target.value })} required /></Field>
                <Field label={t('admin.wiz.ownerPassword', 'Initial password (min 8)')}><input className="input-field" type="text" value={account.ownerPassword} onChange={(e) => setAccount({ ...account, ownerPassword: e.target.value })} required /></Field>
              </div>
              <p className="text-xs text-text-muted">{t('admin.wiz.ownerHint', 'Share these credentials with the tenant so they can sign in and finish setup.')}</p>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary mb-2">{t('admin.wiz.modulesHint', 'Enable the modules this tenant needs. All on by default.')}</p>
          {TENANT_MODULES.map((m) => (
            <label key={m.key} className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={modules[m.key] !== false} onChange={(e) => setModules({ ...modules, [m.key]: e.target.checked })} />
              <span><span className="text-sm font-medium text-text-primary">{m.label}</span><span className="block text-xs text-text-muted">{m.description}</span></span>
            </label>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">{t('admin.wiz.legalHint', 'Optional — pre-fill the company legal entity (PT). The owner can add or edit this later.')}</p>
          <LegalEntityFields value={legal} onChange={setLegal} />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">{t('admin.wiz.branchHint', 'Optional — pre-fill the first branch. It is assigned to the legal entity above if you added one.')}</p>
          <BranchFields value={branch} onChange={setBranch} legalEntities={[]} />
        </div>
      )}
    </Modal>
  );
}

export default function AdminTenantsPage() {
  const { t } = useI18n();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Tenant | null }>({ open: false, editing: null });
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setTenants(await api.get<Tenant[]>('/admin/tenants/enriched')); }
    catch (err) { setError(err instanceof Error ? err.message : t('admin.tenants.failedToLoad', 'Failed to load tenants')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { if (!isAuthenticated()) { window.location.href = '/'; return; } load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (err) { setError(err instanceof Error ? err.message : t('admin.tenants.actionFailed', 'Action failed')); }
  };

  const filtered = tenants.filter((tenant) =>
    (statusFilter === 'all' || tenant.status === statusFilter) &&
    (q.trim() === '' || tenant.name.toLowerCase().includes(q.toLowerCase()) || tenant.slug.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="space-y-6" data-testid="admin-tenants">
      <PageHeader
        title={t('admin.tenants.title', 'Tenants')}
        subtitle={t('admin.tenants.subtitle', 'Every business on the platform — provision, suspend, and drill into any tenant.')}
        actions={<button className="btn-primary" data-testid="create-tenant-btn" onClick={() => setCreateOpen(true)}>+ {t('admin.tenants.createTenant', 'Create Tenant')}</button>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <input className="input-field max-w-xs" placeholder={t('admin.tenants.searchPlaceholder', 'Search name / slug…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input-field max-w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t('admin.tenants.allStatuses', 'All statuses')}</option><option value="active">{t('admin.tenants.statusActive', 'Active')}</option><option value="past_due">{t('admin.tenants.statusPastDue', 'Past due')}</option><option value="suspended">{t('admin.tenants.statusSuspended', 'Suspended')}</option><option value="cancelled">{t('admin.tenants.statusCancelled', 'Cancelled')}</option>
        </select>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <Panel bodyClassName="p-0">
        {loading ? <TableSkeleton rows={6} cols={8} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border">
                {[
                  t('admin.tenants.colName', 'Name'), t('admin.tenants.colStatus', 'Status'), t('admin.tenants.colPlan', 'Plan'),
                  t('admin.tenants.colOutlets', 'Outlets'), t('admin.tenants.colUsers', 'Users'), t('admin.tenants.colOrders30d', 'Orders 30d'),
                  t('admin.tenants.colRevenue30d', 'Revenue 30d'), t('admin.tenants.colLastOrder', 'Last order'), '',
                ].map((h, hi) => (
                  <th key={hi} className={cn(thCls, 'text-left whitespace-nowrap', hi >= 3 && hi <= 6 && 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <EmptyRow colSpan={9}>{t('admin.tenants.noTenants', 'No tenants.')}</EmptyRow>
              ) : filtered.map((tenant) => (
                <tr key={tenant.id} data-testid={`tenant-row-${tenant.id}`} className="hover:bg-surface-sunken/50">
                  <td className={cn(tdCls, 'font-medium')}><Link href={`/admin/tenants/${tenant.slug}`} className="text-primary-600 hover:underline">{tenant.name}</Link></td>
                  <td className={tdCls}><span className={cn('badge capitalize', STATUS_BADGE[tenant.status])}>{tenant.status.replace(/_/g, ' ')}</span></td>
                  <td className={cn(tdCls, 'capitalize')}>{tenant.plan}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{tenant.outlets}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{tenant.users}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{tenant.orders30d}</td>
                  <td className={cn(tdCls, 'text-right tabular-nums')}>{fmtIDR(tenant.revenue30d)}</td>
                  <td className={cn(tdCls, 'text-xs text-text-muted whitespace-nowrap')}>{tenant.lastOrderAt ? fmtDate(tenant.lastOrderAt) : '—'}</td>
                  <td className={cn(tdCls, 'text-right whitespace-nowrap')}>
                    <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, editing: tenant })}>{t('admin.tenants.edit', 'Edit')}</button>
                    {(tenant.status === 'active' || tenant.status === 'past_due') && <button className="btn-ghost text-xs text-amber-600" onClick={() => act(() => api.patch(`/admin/tenants/${tenant.id}/suspend`))}>{t('admin.tenants.suspend', 'Suspend')}</button>}
                    {(tenant.status === 'suspended' || tenant.status === 'cancelled') && <button className="btn-ghost text-xs text-green-600" onClick={() => act(() => api.patch(`/admin/tenants/${tenant.id}/reactivate`))}>{t('admin.tenants.reactivate', 'Reactivate')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {modal.open && <TenantModal initial={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={() => { setModal({ open: false, editing: null }); load(); }} />}
      {createOpen && <CreateTenantWizard onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); load(); }} />}
    </div>
  );
}
