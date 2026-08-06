'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toDateInput, fmtDateRange } from '@/lib/dates';
import BranchFilter from '@/components/dashboard/BranchFilter';
import { SelectAllCheckbox } from '@/components/shared/SelectAllCheckbox';
import { Gift, Ticket, Megaphone, Pencil, Trash2, Check } from 'lucide-react';

interface Branch { id: string; name: string }
interface ServiceLite { id: string; name: string; price?: number }
interface Book { id: string; buyerName: string | null; buyerPhone: string | null; quantity: number; benefitType: string; benefitName?: string | null; unitPrice: number; outletName: string; redeemed: number; createdAt: string; source?: 'sale' | 'bonus' | 'adhoc'; templateName?: string | null }
interface Ticket { id: string; code: string; status: string; expiryDate: string | null; redeemedAt: string | null }
interface Template {
  id: string; name: string; type: 'fixed' | 'percentage' | 'service_pack'; value: number;
  maxUses: number; salePrice: number; validityDays: number | null;
  serviceIds: string[] | null; outletIds: string[] | null; isActive: boolean;
}
interface Promotion {
  id: string; name: string; description: string | null; startDate: string; endDate: string;
  isActive: boolean; outletIds: string[] | null; triggerServiceIds: string[] | null;
  rewardType: string; rewardValue: number; rewardServiceId: string | null; maxQuota: number | null; usedQuota: number;
  memberOnly: boolean; stackable: boolean; minPurchase: number;
}

const REWARD_TYPES = [
  { v: 'discount_fixed', k: 'dash.promotions.rewardFixed', l: 'Fixed discount (Rp)' },
  { v: 'discount_percentage', k: 'dash.promotions.rewardPercentage', l: 'Percentage discount (%)' },
  { v: 'free_product', k: 'dash.promotions.rewardFreeProduct', l: 'Free product/service' },
  { v: 'free_voucher', k: 'dash.promotions.rewardFreeVoucher', l: 'Free wash voucher' },
  { v: 'future_discount', k: 'dash.promotions.rewardFutureDiscount', l: 'Discount on a future purchase' },
];

const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

// ─────────────────────────────────────────── Sell ad-hoc pack modal ──────────
function SellModal({ branches, services, onClose, onSold }: { branches: Branch[]; services: ServiceLite[]; onClose: () => void; onSold: (codes: string[]) => void }) {
  const { t } = useI18n();
  const [outletId, setOutletId] = useState(branches[0]?.id ?? '');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [benefitType, setBenefitType] = useState('service');
  const [benefitServiceId, setBenefitServiceId] = useState('');
  const [benefitValue, setBenefitValue] = useState('0');
  const [unitPrice, setUnitPrice] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await api.post<{ codes: string[] }>('/voucher-tickets/sell', {
        outletId, buyerName: buyerName || undefined, buyerPhone: buyerPhone || undefined,
        quantity: Number(quantity), benefitType,
        benefitServiceId: benefitServiceId || null, benefitValue: Number(benefitValue) || 0,
        unitPrice: Number(unitPrice) || 0, expiryDate: expiryDate || null,
      });
      onSold(res.codes);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.vouchers.errSale', 'Sale failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{t('dash.vouchers.sellVoucherPack', 'Sell Voucher Pack')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.branchCodePrefix', 'Branch (voucher code prefix)')}</label>
            <select aria-label={t('dash.vouchers.outletId', 'Outlet Id')} className="input-field" value={outletId} onChange={(e) => setOutletId(e.target.value)} required>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.buyerName', 'Buyer name')}</label><input aria-label={t('dash.vouchers.buyerName', 'Buyer name')} className="input-field" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.whatsappNumber', 'WhatsApp number')}</label><input aria-label={t('dash.vouchers.buyerPhone', 'Buyer Phone')} className="input-field" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="08123…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.quantity', 'Quantity')}</label><input aria-label={t('dash.vouchers.quantity', 'Quantity')} type="number" min="1" max="1000" className="input-field" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.priceEach', 'Price each (Rp)')}</label><input aria-label={t('dash.vouchers.unitPrice', 'Unit Price')} type="number" className="input-field" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.eachVoucherGives', 'Each voucher gives')}</label>
            <select aria-label={t('dash.vouchers.benefitType', 'Benefit Type')} className="input-field" value={benefitType} onChange={(e) => setBenefitType(e.target.value)}>
              <option value="service">{t('dash.vouchers.aFreeService', 'A free service')}</option>
              <option value="fixed">{t('dash.vouchers.fixedDiscount', 'Fixed discount (Rp)')}</option>
              <option value="percentage">{t('dash.vouchers.percentageDiscount', 'Percentage discount (%)')}</option>
            </select>
          </div>
          {benefitType === 'service' ? (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.freeService', 'Free service')}</label>
              <select aria-label={t('dash.vouchers.benefitServiceId', 'Benefit Service Id')} className="input-field" value={benefitServiceId} onChange={(e) => setBenefitServiceId(e.target.value)}>
                <option value="">{t('dash.vouchers.select', '— select —')}</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ) : (
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.value', 'Value')}</label><input aria-label={t('dash.vouchers.benefitValue', 'Benefit Value')} type="number" className="input-field" value={benefitValue} onChange={(e) => setBenefitValue(e.target.value)} /></div>
          )}
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.expiryDateOptional', 'Expiry date (optional)')}</label><input aria-label={t('dash.vouchers.expiryDate', 'Expiry Date')} type="date" className="input-field" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.vouchers.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.vouchers.issuing', 'Issuing…') : t('dash.vouchers.sellIssue', 'Sell & Issue')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────── Service Pack (template) modal ───────
function TemplateModal({ initial, services, branches, onClose, onSaved }: {
  initial: Template | null; services: ServiceLite[]; branches: Branch[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<Template['type']>(initial?.type ?? 'service_pack');
  const [value, setValue] = useState(String(initial?.value ?? 0));
  const [maxUses, setMaxUses] = useState(String(initial?.maxUses ?? 1));
  const [salePrice, setSalePrice] = useState(String(initial?.salePrice ?? 0));
  const [validityDays, setValidityDays] = useState(String(initial?.validityDays ?? 90));
  const [serviceIds, setServiceIds] = useState<string[]>(initial?.serviceIds ?? []);
  const [outletIds, setOutletIds] = useState<string[]>(initial?.outletIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name,
      type,
      value: type === 'service_pack' ? 0 : Number(value),
      maxUses: Number(maxUses),
      salePrice: Number(salePrice),
      validityDays: validityDays ? Number(validityDays) : null,
      serviceIds: serviceIds.length ? serviceIds : null,
      outletIds: outletIds.length ? outletIds : null,
    };
    try {
      if (initial) await api.put(`/voucher-templates/${initial.id}`, payload);
      else await api.post('/voucher-templates', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.vouchers.errSave', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.vouchers.editServicePack', 'Edit Service Pack') : t('dash.vouchers.newServicePack', 'New Service Pack')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.packName', 'Pack name')}</label>
            <input aria-label={t('dash.vouchers.name', 'Name')} className="input-field" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('dash.vouchers.packNamePlaceholder', 'Voucher Pack 10x Standard Car Wash')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.type', 'Type')}</label>
              <select aria-label={t('dash.vouchers.type', 'Type')} className="input-field" value={type} onChange={(e) => setType(e.target.value as Template['type'])}>
                <option value="service_pack">{t('dash.vouchers.freeServices', 'Free service(s)')}</option>
                <option value="fixed">{t('dash.vouchers.fixedDiscount', 'Fixed discount (Rp)')}</option>
                <option value="percentage">{t('dash.vouchers.percentage', 'Percentage (%)')}</option>
              </select>
            </div>
            {type !== 'service_pack' && (
              <div>
                <label className="block text-sm font-medium mb-1.5">{type === 'percentage' ? t('dash.vouchers.percent', 'Percent') : t('dash.vouchers.amountRp', 'Amount (Rp)')}</label>
                <input aria-label={t('dash.vouchers.value', 'Value')} type="number" className="input-field" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.uses', 'Uses')}</label><input aria-label={t('dash.vouchers.maxUses', 'Max Uses')} type="number" min="1" className="input-field" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.priceRp', 'Price (Rp)')}</label><input aria-label={t('dash.vouchers.salePrice', 'Sale Price')} type="number" min="0" className="input-field" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.validDays', 'Valid (days)')}</label><input aria-label={t('dash.vouchers.validityDays', 'Validity Days')} type="number" min="1" className="input-field" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} /></div>
          </div>
          {type === 'service_pack' && (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.freeServicesGranted', 'Free services granted')}</label>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                <SelectAllCheckbox allIds={services.map((s) => s.id)} selectedIds={serviceIds} onChange={setServiceIds} />
                {services.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                    <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggle(serviceIds, setServiceIds, s.id)} />
                    <span className="flex-1">{s.name}</span>
                    {s.price != null && <span className="text-xs text-text-muted">{fmt(s.price)}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.vouchers.availableAtBranches', 'Available at branches')}</label>
            <p className="text-xs text-text-muted mb-2">{t('dash.vouchers.leaveUncheckedAll', 'Leave all unchecked = every branch.')}</p>
            <div className="space-y-1 max-h-32 overflow-y-auto border border-border rounded-lg p-2">
              <SelectAllCheckbox allIds={branches.map((b) => b.id)} selectedIds={outletIds} onChange={setOutletIds} />
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                  <input type="checkbox" checked={outletIds.includes(b.id)} onChange={() => toggle(outletIds, setOutletIds, b.id)} />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.vouchers.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.vouchers.saving', 'Saving…') : initial ? t('dash.vouchers.update', 'Update') : t('dash.vouchers.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────── Promotion modal ───────────
function PromoModal({ initial, branches, services, onClose, onSaved }: { initial: Promotion | null; branches: Branch[]; services: ServiceLite[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  // toDateInput: the API may hand these back as ISO timestamps, which would make
  // <input type="date"> render blank on edit (same defect as AIRIN-137).
  const [startDate, setStartDate] = useState(toDateInput(initial?.startDate) || new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(toDateInput(initial?.endDate) || new Date().toISOString().slice(0, 10));
  const [rewardType, setRewardType] = useState(initial?.rewardType ?? 'discount_fixed');
  const [rewardValue, setRewardValue] = useState(String(initial?.rewardValue ?? 0));
  const [rewardServiceId, setRewardServiceId] = useState(initial?.rewardServiceId ?? '');
  const [maxQuota, setMaxQuota] = useState(initial?.maxQuota != null ? String(initial.maxQuota) : '');
  const [memberOnly, setMemberOnly] = useState(initial?.memberOnly ?? false);
  const [stackable, setStackable] = useState(initial?.stackable ?? true);
  const [minPurchase, setMinPurchase] = useState(String(initial?.minPurchase ?? 0));
  const [outletIds, setOutletIds] = useState<string[]>(initial?.outletIds ?? []);
  const [triggerServiceIds, setTriggerServiceIds] = useState<string[]>(initial?.triggerServiceIds ?? []);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    const payload = {
      name, description: description || undefined, startDate, endDate, isActive,
      outletIds, triggerServiceIds, rewardType,
      rewardValue: Number(rewardValue) || 0,
      rewardServiceId: rewardServiceId || null,
      maxQuota: maxQuota ? Number(maxQuota) : null,
      memberOnly, stackable,
      minPurchase: Number(minPurchase) || 0,
    };
    try {
      if (initial) await api.put(`/promotions/${initial.id}`, payload);
      else await api.post('/promotions', payload);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.promotions.errSave', 'Save failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{initial ? t('dash.promotions.editPromotion', 'Edit Promotion') : t('dash.promotions.addPromotion', 'Add Promotion')}</h3>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.name', 'Name')}</label><input aria-label={t('dash.promotions.name', 'Name')} className="input-field" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.description', 'Description')}</label><input aria-label={t('dash.promotions.description', 'Description')} className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.startDate', 'Start date')}</label><input aria-label={t('dash.promotions.startDate', 'Start Date')} type="date" className="input-field" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.endDate', 'End date')}</label><input aria-label={t('dash.promotions.endDate', 'End Date')} type="date" className="input-field" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">{t('dash.promotions.reward', 'Reward')}</label>
              <select aria-label={t('dash.promotions.rewardType', 'Reward Type')} className="input-field" value={rewardType} onChange={(e) => setRewardType(e.target.value)}>
                {REWARD_TYPES.map((r) => <option key={r.v} value={r.v}>{t(r.k, r.l)}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.value', 'Value')}</label><input aria-label={t('dash.promotions.rewardValue', 'Reward Value')} type="number" className="input-field" value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} /></div>
          </div>
          {(rewardType === 'free_product' || rewardType === 'future_discount') && (
            <div>
              <label className="block text-sm font-medium mb-1.5">{t('dash.promotions.rewardProduct', 'Reward product/service')}</label>
              <select aria-label={t('dash.promotions.rewardServiceId', 'Reward Service Id')} className="input-field" value={rewardServiceId} onChange={(e) => setRewardServiceId(e.target.value)}>
                <option value="">{t('dash.promotions.select', '— select —')}</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.maxQuota', 'Max quota (blank = unlimited)')}</label><input aria-label={t('dash.promotions.maxQuotaAria', 'Max Quota')} type="number" className="input-field" value={maxQuota} onChange={(e) => setMaxQuota(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm text-text-secondary mt-7"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t('dash.promotions.active', 'Active')}</label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={memberOnly} onChange={(e) => setMemberOnly(e.target.checked)} /> {t('dash.promotions.memberOnly', 'Khusus member')}</label>
            <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} /> {t('dash.promotions.stackable', 'Bisa digabung promo lain')}</label>
            <div><label className="block text-sm font-medium mb-1.5">{t('dash.promotions.minPurchase', 'Min. belanja (Rp)')}</label><input aria-label={t('dash.promotions.minPurchaseAria', 'Min Purchase')} type="number" min="0" className="input-field" value={minPurchase} onChange={(e) => setMinPurchase(e.target.value)} /></div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.promotions.appliesToBranches', 'Applies to branches (none = all)')}</label>
            <SelectAllCheckbox allIds={branches.map((b) => b.id)} selectedIds={outletIds} onChange={setOutletIds} />
            <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-auto border border-border rounded-lg p-2">
              {branches.map((b) => <label key={b.id} className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={outletIds.includes(b.id)} onChange={() => toggle(outletIds, setOutletIds, b.id)} /> {b.name}</label>)}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('dash.promotions.triggerProducts', 'Trigger products (none = any purchase)')}</label>
            <SelectAllCheckbox allIds={services.map((s) => s.id)} selectedIds={triggerServiceIds} onChange={setTriggerServiceIds} />
            <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-auto border border-border rounded-lg p-2">
              {services.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={triggerServiceIds.includes(s.id)} onChange={() => toggle(triggerServiceIds, setTriggerServiceIds, s.id)} /> {s.name}</label>)}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.promotions.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.promotions.saving', 'Saving…') : initial ? t('dash.promotions.update', 'Update') : t('dash.promotions.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VouchersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'sold' | 'packs' | 'promotions'>('packs');
  const [books, setBooks] = useState<Book[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [error, setError] = useState('');
  const [sellOpen, setSellOpen] = useState(false);
  const [tplModal, setTplModal] = useState<{ open: boolean; editing: Template | null }>({ open: false, editing: null });
  const [promoModal, setPromoModal] = useState<{ open: boolean; editing: Promotion | null }>({ open: false, editing: null });
  const [issued, setIssued] = useState<string[] | null>(null);
  const [tickets, setTickets] = useState<{ bookId: string; rows: Ticket[] } | null>(null);
  const [branch, setBranch] = useState('');

  /**
   * Render a promotion's branch scope. `null`/empty outletIds means the
   * promotion applies everywhere — the create form labels it
   * "Applies to branches (none = all)", so show that, not a blank cell.
   */
  const branchNames = useCallback((outletIds: string[] | null) => {
    if (!outletIds || outletIds.length === 0) {
      return <span className="badge bg-gray-100 text-gray-600 text-xs">{t('dash.promotions.allBranches', 'All branches')}</span>;
    }
    return (
      <span className="flex flex-wrap gap-1">
        {outletIds.map((id) => (
          <span key={id} className="badge bg-sky-50 text-sky-700 text-xs">
            {branches.find((b) => b.id === id)?.name ?? id.slice(0, 8)}
          </span>
        ))}
      </span>
    );
  }, [branches, t]);

  // Deep-link support: /dashboard/vouchers?tab=promotions
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'packs' || q === 'sold' || q === 'promotions') setTab(q);
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [bk, tpl, pr, br, sv] = await Promise.all([
        api.get<Book[]>('/voucher-tickets/books'),
        api.get<Template[]>('/voucher-templates'),
        api.get<Promotion[]>('/promotions'),
        api.get<Branch[]>('/outlets'),
        api.get<ServiceLite[]>('/services?includeProducts=true'),
      ]);
      setBooks(bk); setTemplates(tpl); setPromos(pr); setBranches(br); setServices(sv);
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.vouchers.errLoad', 'Failed to load')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const viewTickets = async (bookId: string) => {
    try { setTickets({ bookId, rows: await api.get<Ticket[]>(`/voucher-tickets/books/${bookId}/tickets`) }); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.vouchers.errFailed', 'Failed')); }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm(t('dash.vouchers.deletePackConfirm', 'Delete this service pack?'))) return;
    try { await api.delete(`/voucher-templates/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.vouchers.errDelete', 'Delete failed')); }
  };

  const deletePromotion = async (id: string) => {
    if (!confirm(t('dash.promotions.deleteConfirm', 'Delete promotion?'))) return;
    try { await api.delete(`/promotions/${id}`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('dash.promotions.errFailed', 'Failed')); }
  };
  const fmtReward = (p: Promotion) => {
    if (p.rewardType === 'discount_fixed') return `${fmt(p.rewardValue)} ${t('dash.promotions.off', 'off')}`;
    if (p.rewardType === 'discount_percentage') return `${p.rewardValue}% ${t('dash.promotions.off', 'off')}`;
    if (p.rewardType === 'free_product') return t('dash.promotions.freeProduct', 'Free product');
    if (p.rewardType === 'free_voucher') return t('dash.promotions.freeVoucher', 'Free voucher');
    return t('dash.promotions.futureDiscount', 'Future discount');
  };

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? id;
  const outletName = (id: string) => branches.find((b) => b.id === id)?.name ?? id;

  // Config filter: templates are scoped by outletIds (null/empty = all branches);
  // issued packs are matched by the branch name they were sold under.
  const branchName = branches.find((b) => b.id === branch)?.name ?? null;
  const visibleTemplates = templates.filter(
    (t) => !branch || !t.outletIds || t.outletIds.length === 0 || t.outletIds.includes(branch),
  );
  const visibleBooks = branchName ? books.filter((b) => b.outletName === branchName) : books;
  const visiblePromos = promos.filter(
    (p) => !branch || !p.outletIds || p.outletIds.length === 0 || p.outletIds.includes(branch),
  );

  return (
    <div data-testid="vouchers-page">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.vouchers.title', 'Vouchers & Promotions')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.vouchers.subtitle', 'Define sellable service packs, track issued voucher codes (BRANCH-MMYYYY-NNNNNN), and run promotions.')}</p>
        </div>
        <div className="flex items-center gap-3">
          <BranchFilter value={branch} onChange={setBranch} />
          {tab === 'packs' && <button className="btn-primary whitespace-nowrap" onClick={() => setTplModal({ open: true, editing: null })}>{t('dash.vouchers.newPack', '+ New Pack')}</button>}
          {tab === 'sold' && <button className="btn-primary whitespace-nowrap" onClick={() => setSellOpen(true)}>{t('dash.vouchers.newVoucher', '+ New Voucher')}</button>}
          {tab === 'promotions' && <button className="btn-primary whitespace-nowrap" onClick={() => setPromoModal({ open: true, editing: null })}>{t('dash.promotions.addPromotionBtn', '+ Add Promotion')}</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-5">
        <button onClick={() => setTab('packs')} data-testid="vouchers-tab-packs" className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'packs' ? 'border-primary-500 text-primary-700' : 'border-transparent text-text-secondary hover:text-text-primary'} inline-flex items-center gap-1.5`}><Gift className="w-4 h-4" />{t('dash.vouchers.servicePacks', 'Service Packs')}</button>
        <button onClick={() => setTab('sold')} data-testid="vouchers-tab-sold" className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'sold' ? 'border-primary-500 text-primary-700' : 'border-transparent text-text-secondary hover:text-text-primary'} inline-flex items-center gap-1.5`}><Ticket className="w-4 h-4" />{t('dash.vouchers.issuedVouchers', 'Issued Vouchers')}</button>
        <button onClick={() => setTab('promotions')} data-testid="vouchers-tab-promotions" className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'promotions' ? 'border-primary-500 text-primary-700' : 'border-transparent text-text-secondary hover:text-text-primary'} inline-flex items-center gap-1.5`}><Megaphone className="w-4 h-4" />{t('dash.promotions.title', 'Promotions')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {tab === 'promotions' ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.promotion', 'Promotion')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.reward', 'Reward')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.branch', 'Branch')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.period', 'Period')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.quota', 'Quota')}</th>
              <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.status', 'Status')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.promotions.actions', 'Actions')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {visiblePromos.length === 0 ? <tr><td colSpan={7} className="px-5 py-6 text-sm text-text-muted text-center">{branch ? t('dash.promotions.noPromosBranch', 'No promotions apply to this branch.') : t('dash.promotions.noPromosYet', 'No promotions yet.')}</td></tr> : visiblePromos.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{p.name}<div className="text-xs text-text-muted">{p.description}</div></td>
                  <td className="px-5 py-3.5 text-sm">{fmtReward(p)}</td>
                  <td className="px-5 py-3.5 text-xs">{branchNames(p.outletIds)}</td>
                  <td className="px-5 py-3.5 text-xs text-text-secondary">{fmtDateRange(p.startDate, p.endDate)}</td>
                  <td className="px-5 py-3.5 text-sm">{p.maxQuota != null ? `${p.usedQuota}/${p.maxQuota}` : '∞'}</td>
                  <td className="px-5 py-3.5 text-center"><span className={`badge ${p.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.isActive ? t('dash.promotions.activeBadge', 'Active') : t('dash.promotions.inactive', 'Inactive')}</span></td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setPromoModal({ open: true, editing: p })}>{t('dash.promotions.edit', 'Edit')}</button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => deletePromotion(p.id)}>{t('dash.promotions.delete', 'Delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'packs' ? (
        visibleTemplates.length === 0 ? (
          <div className="card text-sm text-text-muted">{branch ? t('dash.vouchers.noPacksBranch', 'No service packs available at this branch.') : t('dash.vouchers.noPacksYet', 'No service packs yet. Click "New Pack" to create one.')}</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleTemplates.map((tpl) => (
              <div key={tpl.id} className="card">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-text-primary">{tpl.name}</h3>
                  <div className="flex gap-1 shrink-0">
                    <button className="btn-ghost text-xs" onClick={() => setTplModal({ open: true, editing: tpl })}><Pencil className="w-4 h-4" /></button>
                    <button className="btn-ghost text-xs text-red-600" onClick={() => deleteTemplate(tpl.id)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <p className="text-2xl font-bold text-primary-600 mt-2">{tpl.salePrice > 0 ? fmt(tpl.salePrice) : t('dash.vouchers.free', 'Free')}</p>

                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-text-secondary">{t('dash.vouchers.maxUsesLabel', 'Max uses')}</span><span className="font-medium text-text-primary">{tpl.maxUses}×</span></div>
                  <div className="flex justify-between text-sm"><span className="text-text-secondary">{t('dash.vouchers.validDays', 'Valid (days)')}</span><span className="font-medium text-text-primary">{tpl.validityDays ? `${tpl.validityDays} ${t('dash.vouchers.daysUnit', 'days')}` : t('dash.vouchers.noExpiry', 'No expiry')}</span></div>
                  {tpl.type !== 'service_pack' && (
                    <div className="flex justify-between text-sm"><span className="text-text-secondary">{t('dash.vouchers.discount', 'Discount')}</span><span className="font-medium text-text-primary">{tpl.type === 'percentage' ? `${tpl.value}%` : fmt(tpl.value)} {t('dash.vouchers.off', 'off')}</span></div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-text-secondary mb-1.5">{t('dash.vouchers.availableAt', 'Available at')}</p>
                  {tpl.outletIds && tpl.outletIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tpl.outletIds.map((id) => <span key={id} className="badge bg-sky-50 text-sky-700 text-xs">{outletName(id)}</span>)}
                    </div>
                  ) : (
                    <span className="badge bg-gray-100 text-gray-600 text-xs">{t('dash.vouchers.allBranches', 'All branches')}</span>
                  )}
                </div>

                {tpl.serviceIds && tpl.serviceIds.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs font-medium text-text-secondary mb-1.5">{t('dash.vouchers.freeServicesLabel', 'Free services')}</p>
                    <div className="flex flex-wrap gap-1">
                      {tpl.serviceIds.map((id) => <span key={id} className="badge bg-amber-50 text-amber-700 text-xs">{serviceName(id)}</span>)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.buyer', 'Buyer')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.voucher', 'Voucher')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.branch', 'Branch')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.qty', 'Qty')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.redeemed', 'Redeemed')}</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.date', 'Date')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase">{t('dash.vouchers.codes', 'Codes')}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {visibleBooks.length === 0 ? <tr><td colSpan={7} className="px-5 py-6 text-sm text-text-muted text-center">{t('dash.vouchers.noBooksSold', 'No voucher packs sold yet.')}</td></tr> : visibleBooks.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3.5 text-sm font-medium">{b.buyerName ?? '—'}<div className="text-xs text-text-muted">{b.buyerPhone}</div></td>
                  {/* What this book actually is, and how it was obtained. A POS pack
                      purchase and a free campaign bonus used to render as identical
                      anonymous rows (AIRIN-145 / AIRIN-138). */}
                  <td className="px-5 py-3.5 text-sm">
                    {b.templateName ?? b.benefitName ?? '—'}
                    {b.source === 'bonus' && <span className="badge bg-violet-50 text-violet-700 text-xs ml-1.5">{t('dash.vouchers.sourceBonus', 'Bonus')}</span>}
                    {b.source === 'sale' && <span className="badge bg-emerald-50 text-emerald-700 text-xs ml-1.5">{t('dash.vouchers.sourceSale', 'Purchased')}</span>}
                  </td>
                  <td className="px-5 py-3.5 text-sm">{b.outletName}</td>
                  <td className="px-5 py-3.5 text-sm text-right">{b.quantity}</td>
                  <td className="px-5 py-3.5 text-sm text-right">{b.redeemed}/{b.quantity}</td>
                  <td className="px-5 py-3.5 text-xs text-text-muted">{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3.5 text-right"><button className="btn-ghost text-xs" onClick={() => viewTickets(b.id)}>{t('dash.vouchers.viewCodes', 'View codes')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sellOpen && <SellModal branches={branches} services={services} onClose={() => setSellOpen(false)} onSold={(codes) => { setSellOpen(false); setIssued(codes); load(); }} />}
      {tplModal.open && <TemplateModal initial={tplModal.editing} services={services} branches={branches} onClose={() => setTplModal({ open: false, editing: null })} onSaved={() => { setTplModal({ open: false, editing: null }); load(); }} />}
      {promoModal.open && <PromoModal initial={promoModal.editing} branches={branches} services={services} onClose={() => setPromoModal({ open: false, editing: null })} onSaved={() => { setPromoModal({ open: false, editing: null }); load(); }} />}

      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setIssued(null)}>
          <div className="card w-full max-w-md text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"><Check className="w-6 h-6 text-green-600" /></div>
            <h3 className="text-lg font-semibold text-text-primary">{issued.length} {t('dash.vouchers.vouchersIssued', 'vouchers issued')}</h3>
            <p className="text-sm text-text-secondary mt-1">{t('dash.vouchers.sentToWhatsapp', "Sent to the buyer's WhatsApp (if a number was given).")}</p>
            <div className="mt-4 max-h-48 overflow-auto text-left bg-surface-sunken rounded-lg p-3 font-mono text-xs space-y-1">
              {issued.map((c) => <div key={c}>{c}</div>)}
            </div>
            <button className="btn-primary w-full mt-4" onClick={() => setIssued(null)}>{t('dash.vouchers.done', 'Done')}</button>
          </div>
        </div>
      )}

      {tickets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTickets(null)}>
          <div className="card w-full max-w-md max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title mb-3">{t('dash.vouchers.voucherCodes', 'Voucher codes')}</h3>
            <div className="space-y-1.5">
              {tickets.rows.map((t) => (
                <div key={t.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2 text-sm">
                  <span className="font-mono">{t.code}</span>
                  <span className={`badge ${t.status === 'redeemed' ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'}`}>{t.status}</span>
                </div>
              ))}
            </div>
            <button className="btn-secondary w-full mt-4" onClick={() => setTickets(null)}>{t('dash.vouchers.close', 'Close')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
