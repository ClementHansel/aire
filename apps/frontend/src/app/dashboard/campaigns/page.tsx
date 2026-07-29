'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toDateInput, fmtDateRange } from '@/lib/dates';
import { Megaphone, Pencil, Ban, RotateCcw } from 'lucide-react';

type CampaignStatus = 'active' | 'paused' | 'completed' | 'expired';
type CampaignTriggerType = 'membership_plan' | 'voucher_pack';

interface Campaign {
  id: string;
  name: string;
  planId: string | null;
  triggerType: CampaignTriggerType;
  triggerTemplateId: string | null;
  bonusTemplateId: string;
  startDate: string;
  endDate: string;
  cap: number | null;
  perCustomerLimit: number;
  grantsCount: number;
  status: CampaignStatus;
}

interface PlanLite { id: string; name: string }
interface TemplateLite { id: string; name: string }

interface FormState {
  name: string;
  triggerType: CampaignTriggerType;
  planId: string;
  triggerTemplateId: string;
  bonusTemplateId: string;
  startDate: string;
  endDate: string;
  cap: string; // blank = unlimited
  perCustomerLimit: string;
  status: CampaignStatus;
}

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM: FormState = {
  name: '', triggerType: 'membership_plan', planId: '', triggerTemplateId: '', bonusTemplateId: '',
  startDate: today(), endDate: today(),
  cap: '', perCustomerLimit: '1', status: 'active',
};

const STATUS_BADGE: Record<CampaignStatus, string> = {
  active: 'bg-green-50 text-green-700',
  paused: 'bg-gray-100 text-gray-500',
  completed: 'bg-sky-50 text-sky-700',
  expired: 'bg-red-50 text-red-600',
};

function CampaignModal({
  initial, plans, templates, onClose, onSaved,
}: {
  initial: Campaign | null;
  plans: PlanLite[];
  templates: TemplateLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          triggerType: initial.triggerType,
          planId: initial.planId ?? '',
          triggerTemplateId: initial.triggerTemplateId ?? '',
          bonusTemplateId: initial.bonusTemplateId,
          // The API may return these as full ISO timestamps; <input type="date">
          // renders blank for anything but YYYY-MM-DD.
          startDate: toDateInput(initial.startDate),
          endDate: toDateInput(initial.endDate),
          cap: initial.cap != null ? String(initial.cap) : '',
          perCustomerLimit: String(initial.perCustomerLimit),
          status: initial.status,
        }
      : { ...EMPTY_FORM, planId: plans[0]?.id ?? '', bonusTemplateId: templates[0]?.id ?? '' },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name: form.name.trim(),
      triggerType: form.triggerType,
      // Only the field matching triggerType is sent — the other trigger's
      // stale value (e.g. a leftover planId after switching to voucher_pack)
      // must never be submitted, or the backend's exactly-one-trigger check rejects it.
      planId: form.triggerType === 'membership_plan' ? form.planId : null,
      triggerTemplateId: form.triggerType === 'voucher_pack' ? form.triggerTemplateId : null,
      bonusTemplateId: form.bonusTemplateId,
      startDate: form.startDate,
      endDate: form.endDate,
      cap: form.cap.trim() === '' ? null : Number(form.cap),
      perCustomerLimit: Number(form.perCustomerLimit) || 1,
      status: form.status,
    };
    try {
      if (initial) await api.put(`/campaigns/${initial.id}`, payload);
      else await api.post('/campaigns', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.campaigns.errSave', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.campaigns.editTitle', 'Edit Campaign') : t('dash.campaigns.addTitle', 'New Campaign')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.name', 'Campaign name')}</label>
            <input aria-label={t('dash.campaigns.name', 'Campaign name')} className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('dash.campaigns.namePlaceholder', 'e.g. New Member Bonus — July')} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.triggerType', 'Triggering purchase')}</label>
            <select
              aria-label={t('dash.campaigns.triggerType', 'Triggering purchase')}
              className="input-field"
              value={form.triggerType}
              onChange={(e) => setForm({ ...form, triggerType: e.target.value as CampaignTriggerType })}
            >
              <option value="membership_plan">{t('dash.campaigns.triggerTypeMembership', 'Buys a membership plan')}</option>
              <option value="voucher_pack">{t('dash.campaigns.triggerTypeVoucherPack', 'Buys a voucher pack')}</option>
            </select>
          </div>
          {form.triggerType === 'membership_plan' ? (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.triggerPlan', 'Triggering membership plan')}</label>
              <select aria-label={t('dash.campaigns.planId', 'Membership plan')} className="input-field" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} required>
                <option value="">{t('dash.campaigns.selectPlan', '— select a plan —')}</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-xs text-text-muted mt-1">{t('dash.campaigns.triggerPlanHint', 'When a customer buys this plan, the campaign grants the bonus voucher below.')}</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.triggerTemplate', 'Triggering voucher pack')}</label>
              <select aria-label={t('dash.campaigns.triggerTemplateId', 'Triggering voucher pack')} className="input-field" value={form.triggerTemplateId} onChange={(e) => setForm({ ...form, triggerTemplateId: e.target.value })} required>
                <option value="">{t('dash.campaigns.selectTemplate', '— select a voucher template —')}</option>
                {templates.filter((tp) => tp.id !== form.bonusTemplateId).map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
              </select>
              <p className="text-xs text-text-muted mt-1">{t('dash.campaigns.triggerTemplateHint', 'e.g. when a customer buys the "10x Wash" pack, the campaign grants the bonus voucher below (e.g. "3x Spray Wax").')}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.bonusVoucher', 'Bonus voucher granted')}</label>
            <select aria-label={t('dash.campaigns.bonusTemplateId', 'Bonus voucher template')} className="input-field" value={form.bonusTemplateId} onChange={(e) => setForm({ ...form, bonusTemplateId: e.target.value })} required>
              <option value="">{t('dash.campaigns.selectTemplate', '— select a voucher template —')}</option>
              {templates.filter((tp) => tp.id !== form.triggerTemplateId || form.triggerType !== 'voucher_pack').map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.startDate', 'Start date')}</label><input aria-label={t('dash.campaigns.startDate', 'Start date')} type="date" className="input-field" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.endDate', 'End date')}</label><input aria-label={t('dash.campaigns.endDate', 'End date')} type="date" className="input-field" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.cap', 'Cap (first N grants)')}</label>
              <input aria-label={t('dash.campaigns.capAria', 'Cap')} type="number" min="0" className="input-field" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} placeholder={t('dash.campaigns.capPlaceholder', 'Blank = unlimited')} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.perCustomerLimit', 'Per-customer limit')}</label>
              <input aria-label={t('dash.campaigns.perCustomerLimitAria', 'Per-customer limit')} type="number" min="1" className="input-field" value={form.perCustomerLimit} onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })} required />
            </div>
          </div>
          {initial && (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.campaigns.status', 'Status')}</label>
              <select aria-label={t('dash.campaigns.status', 'Status')} className="input-field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}>
                <option value="active">{t('dash.campaigns.statusActive', 'Active')}</option>
                <option value="paused">{t('dash.campaigns.statusPaused', 'Paused')}</option>
                <option value="completed">{t('dash.campaigns.statusCompleted', 'Completed')}</option>
                <option value="expired">{t('dash.campaigns.statusExpired', 'Expired')}</option>
              </select>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.campaigns.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.campaigns.saving', 'Saving…') : initial ? t('dash.campaigns.update', 'Update') : t('dash.campaigns.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const { t } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [cs, pl, tp] = await Promise.all([
        api.get<Campaign[]>('/campaigns'),
        api.get<PlanLite[]>('/membership-plans'),
        api.get<TemplateLite[]>('/voucher-templates'),
      ]);
      setCampaigns(cs); setPlans(pl); setTemplates(tp);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.campaigns.errLoad', 'Failed to load campaigns')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? '—';
  const templateName = (id: string) => templates.find((tp) => tp.id === id)?.name ?? '—';

  const deactivate = async (c: Campaign) => {
    if (!confirm(t('dash.campaigns.deactivateConfirm', `Deactivate "${c.name}"? It will stop granting bonus vouchers; grant history is kept.`))) return;
    try { await api.delete(`/campaigns/${c.id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.campaigns.errAction', 'Action failed')); }
  };

  const reactivate = async (c: Campaign) => {
    try { await api.put(`/campaigns/${c.id}`, { status: 'active' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.campaigns.errAction', 'Action failed')); }
  };

  const statusLabel = (s: CampaignStatus) => t(`dash.campaigns.statusBadge.${s}`, s.charAt(0).toUpperCase() + s.slice(1));

  return (
    <div data-testid="campaigns-page">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.campaigns.title', 'Campaigns')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.campaigns.subtitle', 'Automatically grant a bonus voucher when a customer buys a membership plan or a voucher pack, within a date window and cap.')}</p>
        </div>
        <button className="btn-primary whitespace-nowrap" data-testid="add-campaign-btn" onClick={() => { setEditing(null); setModalOpen(true); }}>+ {t('dash.campaigns.addBtn', 'New Campaign')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.campaigns.loading', 'Loading campaigns…')}</div>
      ) : campaigns.length === 0 ? (
        <div className="card text-sm text-text-muted">
          <Megaphone className="w-5 h-5 mb-2 text-text-muted" />
          {plans.length === 0
            ? t('dash.campaigns.needPlanFirst', 'Create a membership plan first, then come back to set up a campaign.')
            : templates.length === 0
              ? t('dash.campaigns.needTemplateFirst', 'Create a voucher template first (Vouchers → Service Packs), then come back to set up a campaign.')
              : t('dash.campaigns.empty', 'No campaigns yet. Click "New Campaign" to create one.')}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colCampaign', 'Campaign')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colTrigger', 'Trigger purchase')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colBonus', 'Bonus voucher')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colPeriod', 'Period')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colGrants', 'Grants')}</th>
              <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colStatus', 'Status')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.campaigns.colActions', 'Actions')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c) => (
                <tr key={c.id} data-testid={`campaign-row-${c.id}`}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{c.name}<div className="text-xs text-text-muted">{t('dash.campaigns.perCustomerLimit', 'Per-customer limit')}: {c.perCustomerLimit}</div></td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">
                    {c.triggerType === 'voucher_pack' ? (
                      <>
                        <span className="badge bg-sky-50 text-sky-700 text-xs mr-1.5">{t('dash.campaigns.triggerBadgeVoucherPack', 'Voucher pack')}</span>
                        {templateName(c.triggerTemplateId ?? '')}
                      </>
                    ) : (
                      <>
                        <span className="badge bg-amber-50 text-amber-700 text-xs mr-1.5">{t('dash.campaigns.triggerBadgeMembership', 'Membership')}</span>
                        {planName(c.planId ?? '')}
                      </>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">{templateName(c.bonusTemplateId)}</td>
                  <td className="px-5 py-3.5 text-xs text-text-secondary whitespace-nowrap">{fmtDateRange(c.startDate, c.endDate)}</td>
                  <td className="px-5 py-3.5 text-sm text-right">{c.grantsCount}{c.cap != null ? ` / ${c.cap}` : ''}</td>
                  <td className="px-5 py-3.5 text-center"><span className={`badge ${STATUS_BADGE[c.status]}`}>{statusLabel(c.status)}</span></td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => { setEditing(c); setModalOpen(true); }}><Pencil className="w-3.5 h-3.5 inline mr-1" />{t('dash.campaigns.edit', 'Edit')}</button>
                    {c.status === 'active' ? (
                      <button className="btn-ghost text-xs text-amber-600" onClick={() => deactivate(c)}><Ban className="w-3.5 h-3.5 inline mr-1" />{t('dash.campaigns.deactivate', 'Deactivate')}</button>
                    ) : c.status === 'paused' ? (
                      <button className="btn-ghost text-xs text-green-700" onClick={() => reactivate(c)}><RotateCcw className="w-3.5 h-3.5 inline mr-1" />{t('dash.campaigns.reactivate', 'Reactivate')}</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <CampaignModal initial={editing} plans={plans} templates={templates} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />
      )}
    </div>
  );
}
