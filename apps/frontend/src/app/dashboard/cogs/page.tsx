'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  PageHeader, Panel, ErrorBanner, Field, Spinner,
  TableWrap, EmptyRow, TableSkeleton, thCls, tdCls, fmtIDR,
} from '@/components/dashboard/ui';
import { ServiceModal, RecipeModal, type ServiceDTO, type Category, type Brand } from '../services/service-forms';

interface CostType { id: string; name: string; kind: 'fixed' | 'percentage'; isActive: boolean }

export default function CogsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ServiceDTO[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [costTypes, setCostTypes] = useState<CostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editPrice, setEditPrice] = useState<ServiceDTO | null>(null);
  const [recipeFor, setRecipeFor] = useState<ServiceDTO | null>(null);
  const [newType, setNewType] = useState({ name: '', kind: 'fixed' as 'fixed' | 'percentage' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [svc, prod, cats, brs, types] = await Promise.all([
        api.get<ServiceDTO[]>('/services').catch(() => [] as ServiceDTO[]),
        api.get<ServiceDTO[]>('/products').catch(() => [] as ServiceDTO[]),
        api.get<Category[]>('/categories').catch(() => [] as Category[]),
        api.get<Brand[]>('/brands').catch(() => [] as Brand[]),
        api.get<CostType[]>('/cost-component-types').catch(() => [] as CostType[]),
      ]);
      // Services + products share one table; merge and dedupe by id.
      const byId = new Map<string, ServiceDTO>();
      [...svc, ...prod].forEach((s) => byId.set(s.id, s));
      setItems([...byId.values()]);
      setCategories(cats); setBrands(brs); setCostTypes(types);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.cogs.loadError', 'Failed to load recipes & pricing'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const addCostType = async () => {
    if (!newType.name.trim()) return;
    setBusy(true); setError('');
    try { await api.post('/cost-component-types', { name: newType.name.trim(), kind: newType.kind }); setNewType({ name: '', kind: 'fixed' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.cogs.actionFailed', 'Action failed')); }
    finally { setBusy(false); }
  };
  const removeCostType = async (id: string) => {
    if (!confirm(t('dash.cogs.confirmRemoveType', 'Remove this cost component type?'))) return;
    try { await api.delete(`/cost-component-types/${id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('dash.cogs.actionFailed', 'Action failed')); }
  };

  const filtered = useMemo(
    () => items.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    [items, search],
  );
  const catName = (id: string | null) => (id ? categories.find((c) => c.id === id)?.name ?? null : null);
  // A 'product' row edits via /products; everything else via /services.
  const basePathFor = (s: ServiceDTO) => (s.category === 'product' ? '/products' : '/services');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('dash.cogs.title', 'Recipe & Pricing')}
        subtitle={t('dash.cogs.subtitle', 'Define what each product costs to make (its recipe / BOM + overhead) and set its selling price. Cost is frozen onto every sale, feeding the P&L margin reports.')}
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Cost component types (reusable overheads) */}
      <Panel
        title={t('dash.cogs.costTypes', 'Cost component types')}
        description={t('dash.cogs.costTypesDesc', 'Reusable overheads (e.g. labour, packaging) added on top of ingredient cost in a recipe — a fixed Rp amount or a % of price.')}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('dash.cogs.typeName', 'Name')}><input className="input-field" value={newType.name} placeholder={t('dash.cogs.typeNamePh', 'e.g. Labour')} onChange={(e) => setNewType({ ...newType, name: e.target.value })} /></Field>
          <Field label={t('dash.cogs.typeKind', 'Kind')}>
            <select className="input-field" value={newType.kind} onChange={(e) => setNewType({ ...newType, kind: e.target.value as 'fixed' | 'percentage' })}>
              <option value="fixed">{t('dash.cogs.fixed', 'Fixed (Rp)')}</option>
              <option value="percentage">{t('dash.cogs.percentage', 'Percentage (%)')}</option>
            </select>
          </Field>
          <button className="btn-secondary" onClick={addCostType} disabled={busy || !newType.name.trim()}>{busy ? <Spinner /> : t('dash.cogs.addType', 'Add type')}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {costTypes.length === 0 ? <p className="text-sm text-text-muted">{t('dash.cogs.noTypes', 'No cost types yet.')}</p> : costTypes.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-sunken/40 px-2.5 py-1 text-sm">
              {c.name}
              <span className="badge bg-surface-sunken text-text-secondary">{c.kind === 'fixed' ? 'Rp' : '%'}</span>
              <button className="text-text-muted hover:text-rose-600" onClick={() => removeCostType(c.id)} aria-label="Remove">✕</button>
            </span>
          ))}
        </div>
      </Panel>

      {/* Sellable items — price + recipe */}
      <Panel
        title={t('dash.cogs.items', 'Products & services')}
        description={t('dash.cogs.itemsDesc', 'Set the price and build the recipe for each sellable item.')}
        bodyClassName="p-0"
        actions={
          <input className="input-field max-w-[220px] py-1.5 text-sm" placeholder={t('dash.cogs.search', 'Search…')} value={search} onChange={(e) => setSearch(e.target.value)} />
        }
      >
        {loading ? <TableSkeleton rows={8} cols={4} /> : (
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className={`${thCls} text-left`}>{t('dash.cogs.item', 'Item')}</th>
                <th className={`${thCls} text-left`}>{t('dash.cogs.category', 'Category')}</th>
                <th className={`${thCls} text-right`}>{t('dash.cogs.price', 'Price')}</th>
                <th className={`${thCls} text-right`}>{t('dash.cogs.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <EmptyRow colSpan={4}>{search ? t('dash.cogs.noMatch', 'No items match your search.') : t('dash.cogs.noItems', 'No products or services yet. Add them from the Products / Services pages first.')}</EmptyRow>
              ) : filtered.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunken/40">
                  <td className={tdCls}>
                    <div className="font-medium text-text-primary">{s.name}</div>
                    <div className="text-xs text-text-muted">{s.businessUnit ?? 'AIRE'}{s.isActive ? '' : ` · ${t('dash.cogs.inactive', 'inactive')}`}</div>
                  </td>
                  <td className={`${tdCls} text-text-secondary`}>{catName(s.categoryId) || <span className="capitalize">{s.category.replace('_', ' ')}</span>}</td>
                  <td className={`${tdCls} text-right font-medium tabular-nums`}>{fmtIDR(s.price)}</td>
                  <td className={`${tdCls} text-right`}>
                    <span className="inline-flex gap-1">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setRecipeFor(s)}>{t('dash.cogs.editRecipe', 'Recipe')}</button>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditPrice(s)}>{t('dash.cogs.editPrice', 'Price')}</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {editPrice && (
        <ServiceModal
          initial={editPrice}
          categories={categories}
          brands={brands}
          lockedCategory={editPrice.category}
          basePath={basePathFor(editPrice)}
          titles={{ add: t('dash.cogs.editPriceTitle', 'Edit pricing'), edit: t('dash.cogs.editPriceTitle', 'Edit pricing') }}
          onClose={() => setEditPrice(null)}
          onSaved={() => { setEditPrice(null); load(); }}
        />
      )}
      {recipeFor && <RecipeModal service={recipeFor} onClose={() => setRecipeFor(null)} />}
    </div>
  );
}
