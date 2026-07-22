'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ─────────────────────────────────────────────────────────────── Types ──────
interface ItemRow { id: string; name: string; customerVisible: boolean }
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
interface DayHours { open?: string; close?: string; closed?: boolean }
type OpeningHours = Partial<Record<DayKey, DayHours>>;
interface OutletRow extends ItemRow { phone: string | null; mapsUrl: string | null; openingHours: OpeningHours | null }

const WEEK_DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Senin' }, { key: 'tue', label: 'Selasa' }, { key: 'wed', label: 'Rabu' },
  { key: 'thu', label: 'Kamis' }, { key: 'fri', label: 'Jumat' }, { key: 'sat', label: 'Sabtu' },
  { key: 'sun', label: 'Minggu' },
];

interface Categories {
  service_prices: boolean;
  promotions: boolean;
  membership_plans: boolean;
  vouchers: boolean;
  branches: boolean;
  opening_hours: boolean;
  branch_contact: boolean;
}

interface KnowledgeItems {
  services: ItemRow[];
  promotions: ItemRow[];
  plans: ItemRow[];
  outlets: OutletRow[];
}

interface KnowledgeResponse {
  productKnowledge: string | null;
  skills: string | null;
  categories: Categories;
  items: KnowledgeItems;
}

type ItemListKey = keyof KnowledgeItems;

const ITEM_TYPE: Record<ItemListKey, 'service' | 'promotion' | 'plan' | 'outlet'> = {
  services: 'service', promotions: 'promotion', plans: 'plan', outlets: 'outlet',
};

interface CategoryMeta { key: keyof Categories; labelKey: string; labelFallback: string; listKey: ItemListKey | null }

// Order mirrors the 7 toggles in the backend contract. `listKey` is the
// per-item list (if any) that lives "under" this category toggle.
const CATEGORY_META: CategoryMeta[] = [
  { key: 'service_prices', labelKey: 'dash.knowledge.catServicePrices', labelFallback: 'Service prices', listKey: 'services' },
  { key: 'promotions', labelKey: 'dash.knowledge.catPromotions', labelFallback: 'Promotions', listKey: 'promotions' },
  { key: 'membership_plans', labelKey: 'dash.knowledge.catMembershipPlans', labelFallback: 'Membership plans', listKey: 'plans' },
  { key: 'vouchers', labelKey: 'dash.knowledge.catVouchers', labelFallback: 'Customer vouchers', listKey: null },
  { key: 'branches', labelKey: 'dash.knowledge.catBranches', labelFallback: 'Branch list', listKey: 'outlets' },
  { key: 'opening_hours', labelKey: 'dash.knowledge.catOpeningHours', labelFallback: 'Opening hours', listKey: null },
  { key: 'branch_contact', labelKey: 'dash.knowledge.catBranchContact', labelFallback: 'Branch phone & location (Maps)', listKey: null },
];

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

// ───────────────────────────────────────────────────────────── Toggle ───────
function MiniToggle({ checked, onChange, disabled, big }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative shrink-0 ${big ? 'w-12 h-7' : 'w-9 h-5'} rounded-full transition-colors ${checked ? 'bg-primary-500' : 'bg-gray-300'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={`absolute top-0.5 left-0.5 ${big ? 'w-6 h-6' : 'w-4 h-4'} bg-white rounded-full transition-transform ${checked ? (big ? 'translate-x-5' : 'translate-x-4') : ''}`} />
    </button>
  );
}

// ───────────────────────────────────────────────────────── Item row ─────────
function KnowledgeItemRow({
  item, disabled, onVisible, onOutletField,
}: {
  item: ItemRow | OutletRow;
  disabled: boolean;
  onVisible: (v: boolean) => void;
  onOutletField?: (patch: Partial<Pick<OutletRow, 'phone' | 'mapsUrl' | 'openingHours'>>) => void;
}) {
  const { t } = useI18n();
  if ('phone' in item) {
    const hours = item.openingHours ?? {};
    const setDay = (day: DayKey, patch: DayHours | null) => {
      const next: OpeningHours = { ...hours };
      if (patch === null) delete next[day];
      else next[day] = patch;
      onOutletField?.({ openingHours: Object.keys(next).length ? next : null });
    };
    return (
      <div className="rounded-lg border border-border/70 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${disabled ? 'text-text-muted' : 'text-text-primary'}`}>{item.name}</span>
          <MiniToggle checked={item.customerVisible} disabled={disabled} onChange={onVisible} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input-field text-xs py-1.5"
            disabled={disabled}
            value={item.phone ?? ''}
            onChange={(e) => onOutletField?.({ phone: e.target.value })}
            placeholder={t('dash.knowledge.phonePlaceholder', '08xxxxxxxxxx')}
            aria-label={t('dash.knowledge.phoneLabel', 'Phone')}
          />
          <input
            className="input-field text-xs py-1.5"
            disabled={disabled}
            value={item.mapsUrl ?? ''}
            onChange={(e) => onOutletField?.({ mapsUrl: e.target.value })}
            placeholder={t('dash.knowledge.mapsUrlPlaceholder', 'https://maps.google.com/…')}
            aria-label={t('dash.knowledge.mapsUrlLabel', 'Google Maps URL')}
          />
        </div>
        {/* Opening hours — editable per weekday so the AI always answers "jam buka?" correctly. */}
        <div className="pt-1">
          <p className="text-xs font-medium text-text-secondary mb-1">{t('dash.knowledge.openingHoursLabel', 'Opening hours')}</p>
          <div className="space-y-1">
            {WEEK_DAYS.map(({ key, label }) => {
              const d = hours[key] ?? {};
              const closed = d.closed === true;
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 text-text-muted">{label}</span>
                  <input
                    type="time"
                    className="input-field text-xs py-1 px-1.5 w-24"
                    disabled={disabled || closed}
                    value={d.open ?? ''}
                    onChange={(e) => setDay(key, { ...d, closed: false, open: e.target.value })}
                    aria-label={`${label} ${t('dash.knowledge.openLabel', 'open')}`}
                  />
                  <span className="text-text-muted">–</span>
                  <input
                    type="time"
                    className="input-field text-xs py-1 px-1.5 w-24"
                    disabled={disabled || closed}
                    value={d.close ?? ''}
                    onChange={(e) => setDay(key, { ...d, closed: false, close: e.target.value })}
                    aria-label={`${label} ${t('dash.knowledge.closeLabel', 'close')}`}
                  />
                  <label className="flex items-center gap-1 ml-auto text-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={closed}
                      onChange={(e) => setDay(key, e.target.checked ? { closed: true } : null)}
                    />
                    {t('dash.knowledge.closedLabel', 'Tutup')}
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-sm ${disabled ? 'text-text-muted' : 'text-text-primary'}`}>{item.name}</span>
      <MiniToggle checked={item.customerVisible} disabled={disabled} onChange={onVisible} />
    </div>
  );
}

// ─────────────────────────────────────────────────────── Category card ──────
function CategorySection({
  meta, enabled, onToggle, expanded, onExpandToggle, items, onItemVisible, onOutletField,
}: {
  meta: CategoryMeta;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  expanded: boolean;
  onExpandToggle: () => void;
  items: (ItemRow | OutletRow)[] | null;
  onItemVisible?: (id: string, v: boolean) => void;
  onOutletField?: (id: string, patch: Partial<Pick<OutletRow, 'phone' | 'mapsUrl' | 'openingHours'>>) => void;
}) {
  const { t } = useI18n();
  const hasItems = items != null;
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 bg-surface-sunken/40">
        <div className="flex items-center gap-2">
          {hasItems ? (
            <button
              type="button"
              onClick={onExpandToggle}
              className="text-text-muted hover:text-text-primary"
              aria-label={expanded ? t('dash.knowledge.hideDetails', 'Hide details') : t('dash.knowledge.showDetails', 'Show details')}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}
          <span className="text-sm font-medium text-text-primary">{t(meta.labelKey, meta.labelFallback)}</span>
          {hasItems && <span className="text-xs text-text-muted">({items.length})</span>}
        </div>
        <MiniToggle big checked={enabled} onChange={onToggle} />
      </div>
      {hasItems && expanded && (
        <div className="px-3 py-2.5 border-t border-border space-y-2">
          {!enabled && (
            <p className="text-xs text-amber-600">
              {t('dash.knowledge.categoryOffHint', "This category is off — items below won't be shared until it's turned back on.")}
            </p>
          )}
          {items.length === 0 && <p className="text-xs text-text-muted">{t('dash.knowledge.itemsEmpty', 'None yet.')}</p>}
          {items.map((it) => (
            <KnowledgeItemRow
              key={it.id}
              item={it}
              disabled={!enabled}
              onVisible={(v) => onItemVisible?.(it.id, v)}
              onOutletField={(patch) => onOutletField?.(it.id, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────── Page ────────
export default function KnowledgePage() {
  const { t } = useI18n();
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [original, setOriginal] = useState<KnowledgeResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get<KnowledgeResponse>('/agent-config/knowledge');
      setData(res); setOriginal(clone(res));
    } catch (err) { setError(err instanceof Error ? err.message : t('dash.knowledge.failedToLoad', 'Failed to load')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const toggleExpand = (key: string) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const setCategory = (key: keyof Categories, v: boolean) =>
    setData((d) => (d ? { ...d, categories: { ...d.categories, [key]: v } } : d));

  const setItemVisible = (listKey: ItemListKey, id: string, v: boolean) =>
    setData((d) => {
      if (!d) return d;
      const list = d.items[listKey].map((it) => (it.id === id ? { ...it, customerVisible: v } : it));
      return { ...d, items: { ...d.items, [listKey]: list } };
    });

  const setOutletField = (id: string, patch: Partial<Pick<OutletRow, 'phone' | 'mapsUrl' | 'openingHours'>>) =>
    setData((d) => {
      if (!d) return d;
      return { ...d, items: { ...d.items, outlets: d.items.outlets.map((o) => (o.id === id ? { ...o, ...patch } : o)) } };
    });

  // Diff the draft against the last-loaded snapshot so we only ever PUT what
  // actually changed (per the contract: "send only what changed").
  const buildPayload = (): Record<string, unknown> | null => {
    if (!data || !original) return null;
    const payload: Record<string, unknown> = {};

    if (data.productKnowledge !== original.productKnowledge) payload.productKnowledge = data.productKnowledge;
    if (data.skills !== original.skills) payload.skills = data.skills;

    const catDiff: Partial<Categories> = {};
    (Object.keys(data.categories) as (keyof Categories)[]).forEach((k) => {
      if (data.categories[k] !== original.categories[k]) catDiff[k] = data.categories[k];
    });
    if (Object.keys(catDiff).length) payload.categories = catDiff;

    const itemVisibility: { type: string; id: string; visible: boolean }[] = [];
    (Object.keys(data.items) as ItemListKey[]).forEach((listKey) => {
      data.items[listKey].forEach((it) => {
        const orig = original.items[listKey].find((o) => o.id === it.id);
        if (orig && orig.customerVisible !== it.customerVisible) {
          itemVisibility.push({ type: ITEM_TYPE[listKey], id: it.id, visible: it.customerVisible });
        }
      });
    });
    if (itemVisibility.length) payload.itemVisibility = itemVisibility;

    const outletContacts: { id: string; phone?: string | null; mapsUrl?: string | null; openingHours?: OpeningHours | null }[] = [];
    data.items.outlets.forEach((o) => {
      const orig = original.items.outlets.find((x) => x.id === o.id);
      if (!orig) return;
      const hoursChanged = JSON.stringify(orig.openingHours ?? null) !== JSON.stringify(o.openingHours ?? null);
      if (orig.phone !== o.phone || orig.mapsUrl !== o.mapsUrl || hoursChanged) {
        const entry: { id: string; phone?: string | null; mapsUrl?: string | null; openingHours?: OpeningHours | null } = { id: o.id };
        if (orig.phone !== o.phone) entry.phone = o.phone;
        if (orig.mapsUrl !== o.mapsUrl) entry.mapsUrl = o.mapsUrl;
        if (hoursChanged) entry.openingHours = o.openingHours;
        outletContacts.push(entry);
      }
    });
    if (outletContacts.length) payload.outletContacts = outletContacts;

    return payload;
  };

  const save = async () => {
    const payload = buildPayload();
    if (!payload || Object.keys(payload).length === 0) {
      setSaved(true); setError('');
      window.setTimeout(() => setSaved(false), 1500);
      return;
    }
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await api.put<KnowledgeResponse>('/agent-config/knowledge', payload);
      setData(updated); setOriginal(clone(updated)); setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.knowledge.saveFailed', 'Save failed'));
    } finally { setSaving(false); }
  };

  if (!data) {
    return (
      <div data-testid="knowledge-page">
        {error
          ? <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          : <p className="text-text-muted">{t('dash.knowledge.loading', 'Loading…')}</p>}
      </div>
    );
  }

  return (
    <div data-testid="knowledge-page">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('dash.knowledge.title', 'AI Knowledge')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.knowledge.subtitle', 'Control what Irene (your WhatsApp AI) knows and may share with customers.')}</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? t('dash.knowledge.saving', 'Saving…') : t('dash.knowledge.saveChanges', 'Save changes')}
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}
      {saved && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 mb-4">{t('dash.knowledge.savedMsg', 'Saved.')}</div>}

      <div className="space-y-5 max-w-3xl">
        {/* Section 1 — free-text product knowledge & skills */}
        <div className="card">
          <h2 className="section-title">{t('dash.knowledge.sectionKnowledgeTitle', 'Product knowledge')}</h2>
          <p className="section-description mb-2">
            {t('dash.knowledge.productKnowledgeHelp', 'Business info Irene may use to answer customers — e.g. branch address & contact, terms, FAQ.')}
          </p>
          <textarea
            className="input-field"
            rows={8}
            value={data.productKnowledge ?? ''}
            onChange={(e) => setData((d) => (d ? { ...d, productKnowledge: e.target.value } : d))}
            placeholder={t('dash.knowledge.productKnowledgePlaceholder', 'Opening hours, address, membership terms, FAQ…')}
          />

          <div className="mt-4">
            <label className="block text-sm font-medium mb-1.5">{t('dash.knowledge.skillsLabel', 'Reply skills (optional)')}</label>
            <p className="text-xs text-text-muted mb-1.5">{t('dash.knowledge.skillsHelp', 'Guidance for reply style/scenarios (optional).')}</p>
            <textarea
              className="input-field"
              rows={4}
              value={data.skills ?? ''}
              onChange={(e) => setData((d) => (d ? { ...d, skills: e.target.value } : d))}
              placeholder={t('dash.knowledge.skillsPlaceholder', 'Greet warmly in Bahasa. Offer the nearest branch when asked about location…')}
            />
          </div>
        </div>

        {/* Section 2 + 3 — sharing categories with per-item visibility */}
        <div className="card">
          <h2 className="section-title">{t('dash.knowledge.sectionSharingTitle', 'Data you allow Irene to share with customers')}</h2>
          <p className="section-description mb-3">
            {t('dash.knowledge.sectionSharingHelp', "Turn a category off and Irene won't reveal that information to customers.")}
          </p>

          <div className="space-y-3">
            {CATEGORY_META.map((cat) => (
              <CategorySection
                key={cat.key}
                meta={cat}
                enabled={data.categories[cat.key]}
                onToggle={(v) => setCategory(cat.key, v)}
                expanded={!!expanded[cat.key]}
                onExpandToggle={() => toggleExpand(cat.key)}
                items={cat.listKey ? data.items[cat.listKey] : null}
                onItemVisible={cat.listKey ? (id, v) => setItemVisible(cat.listKey as ItemListKey, id, v) : undefined}
                onOutletField={cat.listKey === 'outlets' ? setOutletField : undefined}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
