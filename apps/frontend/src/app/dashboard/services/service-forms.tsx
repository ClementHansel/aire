'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { SelectAllCheckbox } from '@/components/shared/SelectAllCheckbox';

export interface ServiceDTO {
  id: string;
  tenantId: string;
  outletId: string | null;
  name: string;
  category: 'car_wash' | 'product' | 'add_on';
  businessUnit: 'AIRE' | 'LEAD';
  categoryId: string | null;
  brandId: string | null;
  /** Branches this item is sold at. null/empty/absent = every branch. */
  outletIds?: string[] | null;
  price: number;
  isActive: boolean;
  isMainService: boolean;
  sortOrder: number;
  barcode?: string | null;
  /** Per-item opt-in: whether a cashier may apply a manual discount at all (AIRIN-122/123). */
  dynamicDiscountEnabled?: boolean;
  /** Shape of the per-item discount cap. Null/absent when dynamicDiscountEnabled is false. */
  dynamicDiscountKind?: 'fixed' | 'percentage' | null;
  /** Per-item discount ceiling: Rupiah when kind='fixed', percent 0-100 when kind='percentage'. */
  maxDiscount?: number | null;
}

export type AppliesTo = 'service' | 'product' | 'both';
export interface Category { id: string; name: string; appliesTo?: AppliesTo }
export interface Brand { id: string; code: string; name: string; color: string; appliesTo?: AppliesTo }
export interface BranchLite { id: string; name: string }

/**
 * Label vocabulary for the three orthogonal groupings a sellable item carries.
 * These were previously labelled inconsistently between the list and the form —
 * the services list called `category` "Category" while the form called the same
 * field "Type" and used "Category" for `categoryId`, so "Category" meant two
 * different things depending on the screen (AIRIN-91). Import these instead of
 * writing literals.
 *
 *  - BUSINESS_UNIT_LABEL → `businessUnit`: which business the item belongs to.
 *  - TYPE_LABEL          → `category`: what kind of line item it is.
 *  - CATALOG_LABEL       → `categoryId`: the tenant's own grouping label.
 */
export const BUSINESS_UNIT_LABEL = { key: 'catalog.businessUnit', fallback: 'Business unit' } as const;
export const TYPE_LABEL = { key: 'catalog.type', fallback: 'Type' } as const;
export const CATALOG_LABEL = { key: 'catalog.category', fallback: 'Category' } as const;
export const BRAND_LABEL = { key: 'catalog.brand', fallback: 'Brand' } as const;
export const BRANCH_LABEL = { key: 'catalog.branches', fallback: 'Available at branches' } as const;
export const DYNAMIC_DISCOUNT_LABEL = { key: 'catalog.dynamicDiscount', fallback: 'Allow cashier discount' } as const;
export const DYNAMIC_DISCOUNT_KIND_LABEL = { key: 'catalog.dynamicDiscountKind', fallback: 'Discount type' } as const;
export const MAX_DISCOUNT_LABEL = { key: 'catalog.maxDiscount', fallback: 'Maximum discount' } as const;

/**
 * The branches an item is really restricted to, as ONE list.
 *
 * There are two generations of branch scoping in the schema: the legacy single
 * `outlet_id` and the multi-branch `outlet_ids[]`. The POS menu query honours
 * BOTH (`outlet_id = $1 OR $1 = ANY(outlet_ids)`), but the dashboard only ever
 * read `outletIds` — so a service pinned to one branch the old way rendered as
 * "All branches" in the list and showed nothing ticked on its edit page, neither
 * matching where it actually sells (AIRIN-148). An empty result genuinely means
 * every branch.
 */
export function effectiveOutletIds(s: { outletId?: string | null; outletIds?: string[] | null }): string[] {
  if (s.outletIds && s.outletIds.length > 0) return s.outletIds;
  return s.outletId ? [s.outletId] : [];
}

/** A category/brand belongs in a form when it targets that item type or 'both'. */
export const matchesScope = (item: { appliesTo?: AppliesTo }, scope: 'service' | 'product') =>
  !item.appliesTo || item.appliesTo === 'both' || item.appliesTo === scope;

export const CATEGORY_LABELS: Record<string, string> = {
  car_wash: 'Car Wash',
  product: 'Product',
  add_on: 'Add-on',
};

export const CATEGORY_KEYS: Record<ServiceDTO['category'], string> = {
  car_wash: 'dash.services.catCarWash',
  product: 'dash.services.catProduct',
  add_on: 'dash.services.catAddOn',
};

interface FormState {
  name: string;
  category: ServiceDTO['category'];
  businessUnit: ServiceDTO['businessUnit'];
  categoryId: string;
  brandId: string;
  outletIds: string[];
  price: string;
  isActive: boolean;
  isMainService: boolean;
  barcode: string;
  dynamicDiscountEnabled: boolean;
  dynamicDiscountKind: 'fixed' | 'percentage';
  maxDiscount: string;
}

/**
 * Create/edit form for a sellable menu item (service or product). Services and
 * products share one table + endpoint (`/services`); `lockedCategory` pins the
 * item type so the Products page can't create a car-wash and vice-versa. Every
 * active item created here shows up on the POS menu.
 */
export function ServiceModal({
  initial,
  categories,
  brands,
  branches = [],
  lockedCategory,
  categoryOptions = ['car_wash', 'add_on', 'product'],
  basePath = '/services',
  titles,
  onClose,
  onSaved,
}: {
  initial: ServiceDTO | null;
  categories: Category[];
  brands: Brand[];
  /** Tenant branches, for the availability picker. Empty = picker hidden. */
  branches?: BranchLite[];
  lockedCategory?: ServiceDTO['category'];
  categoryOptions?: ServiceDTO['category'][];
  /** API base for create/update — '/services' or '/products'. */
  basePath?: string;
  titles?: { add: string; edit: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const isProduct = lockedCategory === 'product';
  const scope: 'service' | 'product' = isProduct ? 'product' : 'service';
  // Labels meant for this item type (or shared 'both') are offered first; the
  // rest are still selectable under an "other scopes" group. Filtering them out
  // entirely made a brand/category the owner had just created in Catalog appear
  // nowhere at all, with nothing on screen explaining why (AIRIN-100) — a
  // scoping hint must not look like data loss.
  const inScope = <T extends { appliesTo?: AppliesTo }>(items: T[]) => items.filter((x) => matchesScope(x, scope));
  const outOfScope = <T extends { appliesTo?: AppliesTo; id: string }>(items: T[], keep?: string | null) =>
    items.filter((x) => !matchesScope(x, scope) && x.id !== keep);
  const scopedBrands = inScope(brands);
  const otherBrands = outOfScope(brands, initial?.brandId);
  const scopedCategories = inScope(categories);
  const otherCategories = outOfScope(categories, initial?.categoryId);
  // The saved value must always be selectable, even if its scope changed since.
  const editedBrand = brands.find((b) => b.id === initial?.brandId && !matchesScope(b, scope));
  const editedCategory = categories.find((c) => c.id === initial?.categoryId && !matchesScope(c, scope));
  const otherScopeLabel = isProduct
    ? t('catalog.serviceOnlyLabels', 'Service-only labels')
    : t('catalog.productOnlyLabels', 'Product-only labels');
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          name: initial.name,
          category: initial.category,
          businessUnit: initial.businessUnit ?? 'AIRE',
          categoryId: initial.categoryId ?? '',
          brandId: initial.brandId ?? '',
          // Seeds from the legacy single outlet_id when there is no outlet_ids[]
          // array, so the ticked branches match where the item actually sells —
          // the POS honours both columns, this form only ever read the array, so a
          // branch-pinned item opened looking tenant-wide (AIRIN-148). Saving then
          // normalises the legacy value into the array (the backend clears
          // outlet_id whenever outlet_ids is written).
          outletIds: effectiveOutletIds(initial),
          price: String(initial.price),
          isActive: initial.isActive,
          isMainService: initial.isMainService,
          barcode: initial.barcode ?? '',
          dynamicDiscountEnabled: initial.dynamicDiscountEnabled ?? false,
          dynamicDiscountKind: initial.dynamicDiscountKind ?? 'fixed',
          maxDiscount: initial.maxDiscount != null ? String(initial.maxDiscount) : '',
        }
      : {
          name: '',
          category: lockedCategory ?? 'car_wash',
          businessUnit: 'AIRE',
          categoryId: '',
          brandId: '',
          // Empty = available everywhere, matching the backend's treatment of a
          // null outlet_ids. New items stay tenant-wide unless narrowed.
          outletIds: [],
          price: '',
          isActive: true,
          isMainService: false,
          barcode: '',
          dynamicDiscountEnabled: false,
          dynamicDiscountKind: 'fixed',
          maxDiscount: '',
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name: form.name,
      category: lockedCategory ?? form.category,
      businessUnit: form.businessUnit,
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      // The backend stores [] as NULL, i.e. "sold at every branch".
      outletIds: form.outletIds,
      price: Number(form.price),
      isActive: form.isActive,
      isMainService: form.isMainService,
      // Only products carry a barcode; empty clears it (autoGenerate may fill in).
      ...(isProduct ? { barcode: form.barcode.trim() || null } : {}),
      // Per-item cashier-discount opt-in (AIRIN-122/123). Kind/max are only
      // meaningful — and only sent — while the flag is on.
      dynamicDiscountEnabled: form.dynamicDiscountEnabled,
      dynamicDiscountKind: form.dynamicDiscountEnabled ? form.dynamicDiscountKind : null,
      maxDiscount: form.dynamicDiscountEnabled ? Number(form.maxDiscount) : null,
    };
    try {
      if (initial) {
        await api.put(`${basePath}/${initial.id}`, payload);
      } else {
        await api.post(basePath, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.services.saveFailed', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const title = initial
    ? titles?.edit ?? t('dash.services.editTitle', 'Edit Service')
    : titles?.add ?? t('dash.services.addTitle', 'Add Service');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-4">{title}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.services.name', 'Name')}</label>
            <input aria-label={t('dash.services.name', 'Name')} className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t(BUSINESS_UNIT_LABEL.key, BUSINESS_UNIT_LABEL.fallback)}</label>
            <select aria-label={t(BUSINESS_UNIT_LABEL.key, BUSINESS_UNIT_LABEL.fallback)} className="input-field" value={form.businessUnit} onChange={(e) => setForm({ ...form, businessUnit: e.target.value as ServiceDTO['businessUnit'] })}>
              <option value="AIRE">{t('dash.services.buAire', 'AIRE · Car Wash')}</option>
              <option value="LEAD">{t('dash.services.buLead', 'LEAD · Detailing & Polishing')}</option>
            </select>
          </div>
          {!lockedCategory && categoryOptions.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t(TYPE_LABEL.key, TYPE_LABEL.fallback)}</label>
              <select aria-label={t(TYPE_LABEL.key, TYPE_LABEL.fallback)} className="input-field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ServiceDTO['category'] })}>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{t(CATEGORY_KEYS[c], CATEGORY_LABELS[c])}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t(BRAND_LABEL.key, BRAND_LABEL.fallback)}</label>
              <select aria-label={t(BRAND_LABEL.key, BRAND_LABEL.fallback)} className="input-field" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
                <option value="">{t('dash.services.none', '— None —')}</option>
                {scopedBrands.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                {editedBrand && <option value={editedBrand.id}>{editedBrand.code} · {editedBrand.name}</option>}
                {otherBrands.length > 0 && (
                  <optgroup label={otherScopeLabel}>
                    {otherBrands.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t(CATALOG_LABEL.key, CATALOG_LABEL.fallback)}</label>
              <select aria-label={t(CATALOG_LABEL.key, CATALOG_LABEL.fallback)} className="input-field" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t('dash.services.none', '— None —')}</option>
                {scopedCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                {editedCategory && <option value={editedCategory.id}>{editedCategory.name}</option>}
                {otherCategories.length > 0 && (
                  <optgroup label={otherScopeLabel}>
                    {otherCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
          {branches.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t(BRANCH_LABEL.key, BRANCH_LABEL.fallback)}</label>
              <p className="text-xs text-text-muted mb-2">{t('catalog.branchesHint', 'Leave all unticked to sell this at every branch. Ticking specific branches hides it from the POS menu everywhere else.')}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                <SelectAllCheckbox
                  allIds={branches.map((b) => b.id)}
                  selectedIds={form.outletIds}
                  onChange={(ids) => setForm({ ...form, outletIds: ids })}
                />
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={form.outletIds.includes(b.id)}
                      onChange={(e) => setForm({
                        ...form,
                        outletIds: e.target.checked
                          ? [...form.outletIds, b.id]
                          : form.outletIds.filter((id) => id !== b.id),
                      })}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {(brands.length === 0 || categories.length === 0) && (
            <p className="text-xs text-text-muted -mt-1">{t('dash.services.catalogHint', 'Brands & categories are optional labels for grouping and reporting. Manage them in Catalog.')}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.services.price', 'Price (Rp)')}</label>
            <input aria-label={t('dash.services.priceAria', 'Price')} type="number" min="0" className="input-field" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </div>
          {isProduct && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('dash.products.barcode', 'Barcode')}</label>
              <input aria-label={t('dash.products.barcode', 'Barcode')} className="input-field" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder={t('dash.products.barcodePlaceholder', 'Scan or type — leave blank to auto-generate')} />
              <p className="mt-1 text-xs text-text-muted">{t('dash.products.barcodeHint', 'Used for POS scan-to-cart and printed labels. Only applies when barcodes are enabled in Settings.')}</p>
            </div>
          )}
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary mb-1.5">
              <input type="checkbox" checked={form.dynamicDiscountEnabled} onChange={(e) => setForm({ ...form, dynamicDiscountEnabled: e.target.checked })} />
              {t(DYNAMIC_DISCOUNT_LABEL.key, DYNAMIC_DISCOUNT_LABEL.fallback)}
            </label>
            <p className="text-xs text-text-muted mb-2">{t('catalog.dynamicDiscountHint', 'Lets a cashier apply a manual discount to this item at checkout, up to the cap below.')}</p>
            {form.dynamicDiscountEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">{t(DYNAMIC_DISCOUNT_KIND_LABEL.key, DYNAMIC_DISCOUNT_KIND_LABEL.fallback)}</label>
                  <select aria-label={t(DYNAMIC_DISCOUNT_KIND_LABEL.key, DYNAMIC_DISCOUNT_KIND_LABEL.fallback)} className="input-field" value={form.dynamicDiscountKind} onChange={(e) => setForm({ ...form, dynamicDiscountKind: e.target.value as 'fixed' | 'percentage' })}>
                    <option value="fixed">{t('catalog.dynamicDiscountFixed', 'Fixed (Rp)')}</option>
                    <option value="percentage">{t('catalog.dynamicDiscountPercentage', 'Percentage (%)')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1.5">{t(MAX_DISCOUNT_LABEL.key, MAX_DISCOUNT_LABEL.fallback)}</label>
                  <input
                    aria-label={t(MAX_DISCOUNT_LABEL.key, MAX_DISCOUNT_LABEL.fallback)}
                    type="number"
                    min="0"
                    max={form.dynamicDiscountKind === 'percentage' ? 100 : undefined}
                    className="input-field"
                    value={form.maxDiscount}
                    onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              {isProduct ? t('dash.products.activeOnMenu', 'Active (shown on POS menu)') : t('dash.services.active', 'Active')}
            </label>
            {!isProduct && (
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={form.isMainService} onChange={(e) => setForm({ ...form, isMainService: e.target.checked })} />
                {t('dash.services.mainService', 'Main service')}
              </label>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('dash.services.cancel', 'Cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('dash.services.saving', 'Saving…') : initial ? t('dash.services.update', 'Update') : t('dash.services.create', 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface InvItem { id: string; name: string; unit: string }
interface CostType { id: string; name: string; kind: 'fixed' | 'percentage' }

/** Recipe / BOM + cost-component editor for a product (service). */
export function RecipeModal({ service, onClose }: { service: ServiceDTO; onClose: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<InvItem[]>([]);
  const [types, setTypes] = useState<CostType[]>([]);
  const [comps, setComps] = useState<{ inventoryItemId: string; quantity: string; unit: string }[]>([]);
  const [costs, setCosts] = useState<{ componentTypeId: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeKind, setNewTypeKind] = useState<'fixed' | 'percentage'>('fixed');

  useEffect(() => {
    Promise.all([
      api.get<{ components: { inventoryItemId: string; quantity: number; unit: string }[]; costComponents: { componentTypeId: string; value: number }[] }>(`/services/${service.id}/recipe`),
      api.get<InvItem[]>(`/inventory/items`),
      api.get<CostType[]>(`/cost-component-types`),
    ])
      .then(([r, inv, t]) => {
        setComps(r.components.map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: String(c.quantity), unit: c.unit })));
        setCosts(r.costComponents.map((c) => ({ componentTypeId: c.componentTypeId, value: String(c.value) })));
        setItems(inv.map((i) => ({ id: i.id, name: i.name, unit: i.unit })));
        setTypes(t);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('dash.services.recipeLoadFailed', 'Failed to load recipe')))
      .finally(() => setLoading(false));
  }, [service.id]);

  const itemUnit = (id: string) => items.find((i) => i.id === id)?.unit ?? 'pcs';
  const addComp = () => { const first = items[0]; setComps((p) => [...p, { inventoryItemId: first?.id ?? '', quantity: '1', unit: first?.unit ?? 'pcs' }]); };
  const addCost = () => { const first = types[0]; setCosts((p) => [...p, { componentTypeId: first?.id ?? '', value: '0' }]); };

  const createType = async () => {
    if (!newTypeName.trim()) return;
    try {
      const nt = await api.post<CostType>('/cost-component-types', { name: newTypeName.trim(), kind: newTypeKind });
      setTypes((p) => [...p, nt]); setNewTypeName('');
      setCosts((p) => [...p, { componentTypeId: nt.id, value: '0' }]);
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.services.addTypeFailed', 'Failed to add type')); }
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.put(`/services/${service.id}/recipe`, {
        components: comps.filter((c) => c.inventoryItemId && Number(c.quantity) > 0).map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: Number(c.quantity), unit: c.unit || itemUnit(c.inventoryItemId) })),
        costComponents: costs.filter((c) => c.componentTypeId).map((c) => ({ componentTypeId: c.componentTypeId, value: Number(c.value) || 0 })),
      });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : t('dash.services.saveFailed', 'Save failed')); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title mb-1">{t('dash.services.recipe', 'Recipe')} · {service.name}</h3>
        <p className="text-xs text-text-muted mb-4">{t('dash.services.recipeDesc', 'Items consumed per unit sold, plus non-physical cost lines. Used for auto stock-deduction and COGS.')}</p>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-3">{error}</div>}
        {loading ? <p className="text-sm text-text-muted">{t('dash.services.loading', 'Loading…')}</p> : (
          <>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold">{t('dash.services.ingredients', 'Ingredients (stock)')}</h4><button className="btn-ghost text-xs" onClick={addComp} disabled={items.length === 0}>{t('dash.services.add', '+ Add')}</button></div>
              {items.length === 0 && <p className="text-xs text-text-muted">{t('dash.services.noInventory', 'No inventory items yet — add some in Inventory first.')}</p>}
              {comps.map((c, i) => (
                <div key={i} className="flex items-center gap-2 mb-2">
                  <select className="input-field py-1 flex-1" value={c.inventoryItemId} onChange={(e) => setComps((p) => p.map((x, j) => j === i ? { ...x, inventoryItemId: e.target.value, unit: itemUnit(e.target.value) } : x))}>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                  </select>
                  <input type="number" className="input-field py-1 w-20 text-right" value={c.quantity} onChange={(e) => setComps((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                  <input className="input-field py-1 w-16" value={c.unit} onChange={(e) => setComps((p) => p.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                  <button className="btn-ghost text-xs text-rose-600" onClick={() => setComps((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold">{t('dash.services.costComponents', 'Cost components')}</h4><button className="btn-ghost text-xs" onClick={addCost} disabled={types.length === 0}>{t('dash.services.add', '+ Add')}</button></div>
              {costs.map((c, i) => {
                const ct = types.find((x) => x.id === c.componentTypeId);
                return (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select className="input-field py-1 flex-1" value={c.componentTypeId} onChange={(e) => setCosts((p) => p.map((x, j) => j === i ? { ...x, componentTypeId: e.target.value } : x))}>
                      {types.map((tt) => <option key={tt.id} value={tt.id}>{tt.name} ({tt.kind === 'percentage' ? '%' : 'Rp'})</option>)}
                    </select>
                    <input type="number" className="input-field py-1 w-24 text-right" value={c.value} onChange={(e) => setCosts((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                    <span className="text-xs text-text-muted w-6">{ct?.kind === 'percentage' ? '%' : 'Rp'}</span>
                    <button className="btn-ghost text-xs text-rose-600" onClick={() => setCosts((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                <input className="input-field py-1 flex-1" placeholder={t('dash.services.newCostType', 'New cost type (e.g. Electricity)')} value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
                <select className="input-field py-1 w-28" value={newTypeKind} onChange={(e) => setNewTypeKind(e.target.value as 'fixed' | 'percentage')}>
                  <option value="fixed">{t('dash.services.fixedRp', 'Fixed Rp')}</option>
                  <option value="percentage">{t('dash.services.percentOfPrice', '% of price')}</option>
                </select>
                <button className="btn-secondary text-xs" onClick={createType} disabled={!newTypeName.trim()}>{t('dash.services.addType', 'Add type')}</button>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={onClose}>{t('dash.services.cancel', 'Cancel')}</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t('dash.services.saving', 'Saving…') : t('dash.services.saveRecipe', 'Save recipe')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
