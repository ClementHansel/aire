'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { MembersPanel } from '@/components/dashboard/MembersPanel';
import { MembershipCardDesigner } from '@/components/dashboard/MembershipCardDesigner';
import { SelectAllCheckbox } from '@/components/shared/SelectAllCheckbox';

interface MembershipPlan {
  id: string;
  tenantId: string;
  name: string;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  price: number;
  outletIds: string[] | null;
  freeServiceIds: string[] | null;
  discountedServices: Array<{ serviceId: string; discountPct?: number; fixedPrice?: number }> | null;
  whatsappWelcomeEnabled: boolean;
  isActive: boolean;
}

interface ServiceOption { id: string; name: string; price: number; category: string; businessUnit?: string }
interface OutletOption { id: string; name: string }

interface FormState {
  name: string;
  durationMonths: string;
  maxUses: string;
  dailyLimit: string;
  maxPlates: string;
  price: string;
  freeServiceIds: string[];
  discountedServices: Array<{ serviceId: string; discountPct?: number; fixedPrice?: number }>;
  outletIds: string[];
  whatsappWelcomeEnabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  durationMonths: '1',
  maxUses: '31',
  dailyLimit: '1',
  maxPlates: '3',
  price: '',
  freeServiceIds: [],
  discountedServices: [],
  outletIds: [],
  whatsappWelcomeEnabled: false,
};

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

function PlanModal({
  initial,
  services,
  outlets,
  onClose,
  onSaved,
}: {
  initial: MembershipPlan | null;
  services: ServiceOption[];
  outlets: OutletOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          durationMonths: String(initial.durationMonths),
          maxUses: String(initial.maxUses),
          dailyLimit: String(initial.dailyLimit),
          maxPlates: String(initial.maxPlates),
          price: String(initial.price),
          freeServiceIds: initial.freeServiceIds ?? [],
          discountedServices: initial.discountedServices ?? [],
          outletIds: initial.outletIds ?? [],
          whatsappWelcomeEnabled: initial.whatsappWelcomeEnabled ?? false,
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Draft row for adding a discounted service. `mode` picks whether `value` is a
  // percentage (1–100) or a fixed member price (Rp); `discountError` surfaces why
  // the Add button did nothing instead of failing silently.
  const [discountDraft, setDiscountDraft] = useState<{ serviceId: string; mode: 'pct' | 'fixed'; value: string }>({
    serviceId: '',
    mode: 'pct',
    value: '',
  });
  const [discountError, setDiscountError] = useState('');

  const toggle = (key: 'freeServiceIds' | 'outletIds', id: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
    }));

  const addDiscount = () => {
    setDiscountError('');
    if (!discountDraft.serviceId) {
      setDiscountError(t('dash.memberships.discountPickService', 'Please pick a service first.'));
      return;
    }
    const value = Number(discountDraft.value);
    if (!Number.isFinite(value) || value <= 0) {
      setDiscountError(
        discountDraft.mode === 'pct'
          ? t('dash.memberships.discountPctInvalid', 'Enter a percentage between 1 and 100.')
          : t('dash.memberships.discountPriceInvalid', 'Enter a member price greater than 0.'),
      );
      return;
    }
    if (discountDraft.mode === 'pct' && value > 100) {
      setDiscountError(t('dash.memberships.discountPctInvalid', 'Enter a percentage between 1 and 100.'));
      return;
    }
    const entry =
      discountDraft.mode === 'pct'
        ? { serviceId: discountDraft.serviceId, discountPct: value }
        : { serviceId: discountDraft.serviceId, fixedPrice: value };
    setForm((f) => ({
      ...f,
      // Replace any existing discount for the same service.
      discountedServices: [
        ...f.discountedServices.filter((d) => d.serviceId !== discountDraft.serviceId),
        entry,
      ],
    }));
    setDiscountDraft({ serviceId: '', mode: discountDraft.mode, value: '' });
  };

  const removeDiscount = (serviceId: string) =>
    setForm((f) => ({
      ...f,
      discountedServices: f.discountedServices.filter((d) => d.serviceId !== serviceId),
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name: form.name,
      durationMonths: Number(form.durationMonths),
      maxUses: Number(form.maxUses),
      dailyLimit: Number(form.dailyLimit),
      maxPlates: Number(form.maxPlates),
      price: Number(form.price),
      freeServiceIds: form.freeServiceIds,
      discountedServices: form.discountedServices,
      whatsappWelcomeEnabled: form.whatsappWelcomeEnabled,
      // Empty selection = available to all branches.
      outletIds: form.outletIds.length > 0 ? form.outletIds : null,
    };
    try {
      if (initial) {
        await api.put(`/membership-plans/${initial.id}`, payload);
      } else {
        await api.post('/membership-plans', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.memberships.saveFailed', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const washServices = services.filter((s) => s.category === 'car_wash');
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.memberships.editPlan', 'Edit Plan') : t('dash.memberships.createPlan', 'Create Plan')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.planName', 'Plan Name')}</label>
            <input aria-label={t('dash.memberships.name', 'Name')} className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.duration', 'Duration')}</label>
            <select aria-label={t('dash.memberships.durationMonths', 'Duration Months')} className="input-field" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}>
              <option value="1">{t('dash.memberships.month1', '1 month')}</option>
              <option value="3">{t('dash.memberships.month3', '3 months')}</option>
              <option value="6">{t('dash.memberships.month6', '6 months')}</option>
              <option value="12">{t('dash.memberships.month12', '12 months')}</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.maxUses', 'Max Uses')}</label>
              <input aria-label={t('dash.memberships.maxUses', 'Max Uses')} type="number" min="1" className="input-field" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.daily', 'Daily')}</label>
              <input aria-label={t('dash.memberships.dailyLimit', 'Daily Limit')} type="number" min="1" className="input-field" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.plates', 'Plates')}</label>
              <input aria-label={t('dash.memberships.maxPlates', 'Max Plates')} type="number" min="1" className="input-field" value={form.maxPlates} onChange={(e) => setForm({ ...form, maxPlates: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.priceRp', 'Price (Rp)')}</label>
            <input aria-label={t('dash.memberships.price', 'Price')} type="number" min="0" className="input-field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.includedFreeWashes', 'Included free washes')}</label>
            <p className="text-xs text-text-muted mb-2">{t('dash.memberships.includedFreeHint', 'Services the member gets free, subject to the daily limit.')}</p>
            <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
              {washServices.length === 0 ? (
                <p className="text-xs text-text-muted">{t('dash.memberships.noWashServices', 'No car wash services found.')}</p>
              ) : (
                <>
                  <SelectAllCheckbox
                    allIds={washServices.map((s) => s.id)}
                    selectedIds={form.freeServiceIds}
                    onChange={(next) => setForm((f) => ({ ...f, freeServiceIds: next }))}
                  />
                  {washServices.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                      <input type="checkbox" checked={form.freeServiceIds.includes(s.id)} onChange={() => toggle('freeServiceIds', s.id)} />
                      <span className="flex-1">{s.name}</span>
                      <span className="text-xs text-text-muted">{fmt(s.price)}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.discountedServices', 'Discounted services')}</label>
            <p className="text-xs text-text-muted mb-2">{t('dash.memberships.discountedHint', 'Services the member gets at a percentage discount.')}</p>
            {form.discountedServices.length > 0 && (
              <div className="space-y-1 mb-2">
                {form.discountedServices.map((d) => (
                  <div key={d.serviceId} className="flex items-center gap-2 text-sm rounded-lg border border-border px-2 py-1">
                    <span className="flex-1">{serviceName(d.serviceId)}</span>
                    <span className="badge bg-amber-50 text-amber-700 text-xs">
                      {d.fixedPrice != null ? fmt(d.fixedPrice) : `${d.discountPct}%`}
                    </span>
                    <button type="button" className="btn-ghost text-xs text-error" onClick={() => removeDiscount(d.serviceId)}>{t('dash.memberships.remove', 'Remove')}</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <select
                  aria-label={t('dash.memberships.discountService', 'Discount service')}
                  className="input-field"
                  value={discountDraft.serviceId}
                  onChange={(e) => setDiscountDraft((d) => ({ ...d, serviceId: e.target.value }))}
                >
                  <option value="">{t('dash.memberships.selectService', 'Select service…')}</option>
                  {services
                    .filter((s) => !form.discountedServices.some((d) => d.serviceId === s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
              </div>
              <div className="w-28">
                <select
                  aria-label={t('dash.memberships.discountMode', 'Discount type')}
                  className="input-field"
                  value={discountDraft.mode}
                  onChange={(e) => setDiscountDraft((d) => ({ ...d, mode: e.target.value as 'pct' | 'fixed', value: '' }))}
                >
                  <option value="pct">{t('dash.memberships.discountModePct', '% off')}</option>
                  <option value="fixed">{t('dash.memberships.discountModeFixed', 'Fixed Rp')}</option>
                </select>
              </div>
              <div className="w-24">
                <input
                  aria-label={discountDraft.mode === 'pct' ? t('dash.memberships.discountPct', 'Discount %') : t('dash.memberships.discountPrice', 'Member price')}
                  type="number"
                  min={discountDraft.mode === 'pct' ? '1' : '0'}
                  max={discountDraft.mode === 'pct' ? '100' : undefined}
                  placeholder={discountDraft.mode === 'pct' ? '%' : 'Rp'}
                  className="input-field"
                  value={discountDraft.value}
                  onChange={(e) => setDiscountDraft((d) => ({ ...d, value: e.target.value }))}
                />
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={addDiscount}>{t('dash.memberships.add', 'Add')}</button>
            </div>
            {discountError && <p className="text-xs text-error mt-1.5">{discountError}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.memberships.availableBranches', 'Available at branches')}</label>
            <p className="text-xs text-text-muted mb-2">{t('dash.memberships.availableBranchesHint', 'Leave all unchecked = available at every branch.')}</p>
            <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
              <SelectAllCheckbox
                allIds={outlets.map((o) => o.id)}
                selectedIds={form.outletIds}
                onChange={(next) => setForm((f) => ({ ...f, outletIds: next }))}
              />
              {outlets.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                  <input type="checkbox" checked={form.outletIds.includes(o.id)} onChange={() => toggle('outletIds', o.id)} />
                  <span>{o.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.whatsappWelcomeEnabled}
                onChange={(e) => setForm({ ...form, whatsappWelcomeEnabled: e.target.checked })}
              />
              <span className="font-medium text-text-primary">{t('dash.memberships.whatsappWelcome', 'Send WhatsApp welcome message')}</span>
            </label>
            <p className="text-xs text-text-muted mt-1 ml-6">{t('dash.memberships.whatsappWelcomeHint', 'Message the member when this plan is activated.')}</p>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.memberships.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.memberships.saving', 'Saving…') : initial ? t('dash.memberships.update', 'Update') : t('dash.memberships.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlansTab() {
  const { t } = useI18n();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MembershipPlan | null>(null);
  const [branch, setBranch] = useState('');

  // Config filter: a plan with no outletIds (or empty) is available at every branch.
  const visiblePlans = plans.filter(
    (p) => !branch || !p.outletIds || p.outletIds.length === 0 || p.outletIds.includes(branch),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [plansData, servicesData, outletsData] = await Promise.all([
        api.get<MembershipPlan[]>('/membership-plans'),
        api.get<ServiceOption[]>('/services?businessUnit=AIRE'),
        api.get<OutletOption[]>('/outlets'),
      ]);
      setPlans(plansData);
      setServices(servicesData);
      setOutlets(outletsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.memberships.loadFailed', 'Failed to load plans'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';
  const outletName = (id: string) => outlets.find((o) => o.id === id)?.name ?? '—';

  const handleDelete = async (id: string) => {
    if (!confirm(t('dash.memberships.deleteConfirm', 'Delete this plan?'))) return;
    try {
      await api.delete(`/membership-plans/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.memberships.deleteFailed', 'Delete failed'));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <p className="text-sm text-text-secondary">{t('dash.memberships.subtitle', 'Configure plans, quotas, included washes, and branch availability.')}</p>
        <div className="flex items-center gap-3">
          <BranchFilter value={branch} onChange={setBranch} />
          <button className="btn-primary whitespace-nowrap px-5" data-testid="add-plan-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>+ {t('dash.memberships.addPlan', 'Add Plan')}</button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.memberships.loading', 'Loading plans…')}</div>
      ) : visiblePlans.length === 0 ? (
        <div className="card text-sm text-text-muted">{branch ? t('dash.memberships.noPlansBranch', 'No plans available at this branch.') : t('dash.memberships.noPlans', 'No plans yet. Click "Add Plan" to create one.')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visiblePlans.map((plan) => (
            <div key={plan.id} className="card relative" data-testid={`plan-row-${plan.id}`}>
              <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
              <p className="text-2xl font-bold text-primary-600 mt-2">Rp {plan.price.toLocaleString('id-ID')}</p>
              <p className="text-xs text-text-muted mt-1">{plan.durationMonths} {plan.durationMonths > 1 ? t('dash.memberships.monthsUnit', 'months') : t('dash.memberships.monthUnit', 'month')}</p>
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex justify-between text-sm"><span className="text-text-secondary">{t('dash.memberships.maxUses', 'Max Uses')}</span><span className="font-medium text-text-primary">{plan.maxUses} {t('dash.memberships.washesUnit', 'washes')}</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-secondary">{t('dash.memberships.dailyLimit', 'Daily Limit')}</span><span className="font-medium text-text-primary">{plan.dailyLimit}{t('dash.memberships.perDay', '/day')}</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-secondary">{t('dash.memberships.maxPlates', 'Max Plates')}</span><span className="font-medium text-text-primary">{plan.maxPlates} {t('dash.memberships.vehiclesUnit', 'vehicles')}</span></div>
              </div>

              {plan.freeServiceIds && plan.freeServiceIds.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-text-secondary mb-1.5">{t('dash.memberships.includedFree', 'Included free')}</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.freeServiceIds.map((id) => (
                      <span key={id} className="badge bg-green-50 text-green-700 text-xs">{serviceName(id)}</span>
                    ))}
                  </div>
                </div>
              )}

              {plan.discountedServices && plan.discountedServices.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-text-secondary mb-1.5">{t('dash.memberships.discounted', 'Discounted')}</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.discountedServices.map((d) => (
                      <span key={d.serviceId} className="badge bg-amber-50 text-amber-700 text-xs">{serviceName(d.serviceId)} {d.fixedPrice != null ? fmt(d.fixedPrice) : `−${d.discountPct}%`}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs font-medium text-text-secondary mb-1.5">{t('dash.memberships.availableAt', 'Available at')}</p>
                {plan.outletIds && plan.outletIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {plan.outletIds.map((id) => (
                      <span key={id} className="badge bg-sky-50 text-sky-700 text-xs">{outletName(id)}</span>
                    ))}
                  </div>
                ) : (
                  <span className="badge bg-gray-100 text-gray-600 text-xs">{t('dash.memberships.allBranches', 'All branches')}</span>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border flex gap-2">
                <button className="btn-secondary flex-1 text-xs" onClick={() => { setEditing(plan); setModalOpen(true); }}>{t('dash.memberships.edit', 'Edit')}</button>
                <button className="btn-ghost text-xs text-error" onClick={() => handleDelete(plan.id)}>{t('dash.memberships.delete', 'Delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <PlanModal initial={editing} services={services} outlets={outlets} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />
      )}
    </div>
  );
}

type MembershipTab = 'plans' | 'members' | 'cards';

export default function MembershipsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<MembershipTab>('plans');

  // Allow deep-linking to a tab, e.g. /dashboard/memberships?tab=members (from CRM).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'members' || q === 'cards' || q === 'plans') setTab(q);
  }, []);

  const tabs: { key: MembershipTab; label: string }[] = [
    { key: 'plans', label: t('dash.memberships.tabPlans', 'Plans') },
    { key: 'members', label: t('dash.memberships.tabMembers', 'Members') },
    { key: 'cards', label: t('dash.memberships.tabCards', 'Cards') },
  ];

  return (
    <div data-testid="memberships-page">
      <h1 className="text-2xl font-bold text-text-primary mb-4" data-testid="memberships-title">{t('dash.memberships.pageTitle', 'Memberships')}</h1>

      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            data-testid={`membership-tab-${tb.key}`}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === tb.key ? 'border-primary-500 text-primary-600' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'plans' && <PlansTab />}
      {tab === 'members' && <MembersPanel />}
      {tab === 'cards' && <MembershipCardDesigner showHeading={false} />}
    </div>
  );
}
