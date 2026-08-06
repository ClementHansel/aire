'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  ServiceModal,
  RecipeModal,
  CATEGORY_LABELS,
  CATEGORY_KEYS,
  BUSINESS_UNIT_LABEL,
  TYPE_LABEL,
  CATALOG_LABEL,
  effectiveOutletIds,
  type ServiceDTO,
  type Category,
  type Brand,
  type BranchLite,
} from './service-forms';

export default function ServicesPage() {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [recipeFor, setRecipeFor] = useState<ServiceDTO | null>(null);

  // Filters + search (AIRIN-119, AIRIN-120). Applied client-side: /services
  // already returns the tenant's full menu in one call, so filtering here avoids
  // a round-trip per keystroke.
  const [search, setSearch] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fBusinessUnit, setFBusinessUnit] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fCategory, setFCategory] = useState('');

  const brandById = useCallback((id: string | null) => id ? brands.find((b) => b.id === id) ?? null : null, [brands]);
  const categoryById = useCallback((id: string | null) => id ? categories.find((c) => c.id === id) ?? null : null, [categories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, cats, brs, outs] = await Promise.all([
        api.get<ServiceDTO[]>('/services'),
        api.get<Category[]>('/categories').catch(() => [] as Category[]),
        api.get<Brand[]>('/brands').catch(() => [] as Brand[]),
        api.get<BranchLite[]>('/outlets').catch(() => [] as BranchLite[]),
      ]);
      // Products live in the same store but are managed on the Products page.
      setServices(data.filter((s) => s.category !== 'product'));
      setCategories(cats);
      setBrands(brs);
      setBranches(outs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.services.loadFailed', 'Failed to load services'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (fBusinessUnit && (s.businessUnit ?? 'AIRE') !== fBusinessUnit) return false;
      if (fBrand && s.brandId !== fBrand) return false;
      if (fCategory && s.categoryId !== fCategory) return false;
      // An item with no branch restriction is sold everywhere, so it matches any
      // branch filter — same rule the POS menu query uses.
      const scope = effectiveOutletIds(s);
      if (fBranch && scope.length > 0 && !scope.includes(fBranch)) return false;
      return true;
    });
  }, [services, search, fBusinessUnit, fBrand, fCategory, fBranch]);

  const filtersActive = Boolean(search.trim() || fBranch || fBusinessUnit || fBrand || fCategory);
  const clearFilters = () => { setSearch(''); setFBranch(''); setFBusinessUnit(''); setFBrand(''); setFCategory(''); };

  const handleDelete = async (id: string) => {
    if (!confirm(t('dash.services.confirmDelete', 'Delete this service?'))) return;
    try {
      await api.delete(`/services/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dash.services.deleteFailed', 'Delete failed'));
    }
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (s: ServiceDTO) => { setEditing(s); setModalOpen(true); };

  return (
    <div data-testid="services-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="services-title">{t('dash.services.title', 'Services')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('dash.services.subtitle', 'Manage your service menu and pricing. Active services appear on the POS menu.')}</p>
        </div>
        <button className="btn-primary" data-testid="add-service-btn" onClick={openAdd}>{t('dash.services.addBtn', '+ Add Service')}</button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">{error}</div>}

      {/* Search + filters (AIRIN-119, AIRIN-120) */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="svc-search" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.services.search', 'Search')}</label>
            <input
              id="svc-search"
              data-testid="services-search"
              className="input-field"
              placeholder={t('dash.services.searchPlaceholder', 'Search service name…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {branches.length > 0 && (
            <div>
              <label htmlFor="svc-f-branch" className="block text-xs font-medium text-text-secondary mb-1">{t('dash.services.branch', 'Branch')}</label>
              <select id="svc-f-branch" data-testid="services-filter-branch" className="input-field" value={fBranch} onChange={(e) => setFBranch(e.target.value)}>
                <option value="">{t('dash.services.allBranches', 'All branches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="svc-f-bu" className="block text-xs font-medium text-text-secondary mb-1">{t(BUSINESS_UNIT_LABEL.key, BUSINESS_UNIT_LABEL.fallback)}</label>
            <select id="svc-f-bu" data-testid="services-filter-business-unit" className="input-field" value={fBusinessUnit} onChange={(e) => setFBusinessUnit(e.target.value)}>
              <option value="">{t('dash.services.allUnits', 'All units')}</option>
              <option value="AIRE">AIRE</option>
              <option value="LEAD">LEAD</option>
            </select>
          </div>
          {brands.length > 0 && (
            <div>
              <label htmlFor="svc-f-brand" className="block text-xs font-medium text-text-secondary mb-1">{t('catalog.brand', 'Brand')}</label>
              <select id="svc-f-brand" data-testid="services-filter-brand" className="input-field" value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
                <option value="">{t('dash.services.allBrands', 'All brands')}</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </div>
          )}
          {categories.length > 0 && (
            <div>
              <label htmlFor="svc-f-cat" className="block text-xs font-medium text-text-secondary mb-1">{t(CATALOG_LABEL.key, CATALOG_LABEL.fallback)}</label>
              <select id="svc-f-cat" data-testid="services-filter-category" className="input-field" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
                <option value="">{t('dash.services.allCategories', 'All categories')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {filtersActive && (
            <button type="button" className="btn-ghost text-xs" onClick={clearFilters}>{t('dash.services.clearFilters', 'Clear filters')}</button>
          )}
        </div>
        {filtersActive && !loading && (
          <p className="mt-2 text-xs text-text-muted">
            {t('dash.services.showingCount', 'Showing')} {visible.length} {t('dash.services.ofCount', 'of')} {services.length}
          </p>
        )}
      </div>

      {loading ? (
        <div className="card text-sm text-text-muted">{t('dash.services.loadingServices', 'Loading services…')}</div>
      ) : services.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.services.empty', 'No services yet. Click "Add Service" to create one.')}</div>
      ) : visible.length === 0 ? (
        <div className="card text-sm text-text-muted">{t('dash.services.noneMatch', 'No services match these filters.')}</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full" data-testid="services-table">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.name', 'Name')}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t(BUSINESS_UNIT_LABEL.key, BUSINESS_UNIT_LABEL.fallback)}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t(TYPE_LABEL.key, TYPE_LABEL.fallback)}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t(CATALOG_LABEL.key, CATALOG_LABEL.fallback)}</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.branches', 'Branches')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.priceCol', 'Price')}</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.status', 'Status')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">{t('dash.services.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((s) => (
                <tr key={s.id} className="hover:bg-surface-sunken/30 transition-colors" data-testid={`service-row-${s.id}`}>
                  <td className="px-5 py-3.5">
                    <div className="text-sm font-medium text-text-primary">{s.name}</div>
                    {(() => { const b = brandById(s.brandId); return b ? (
                      <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-muted">
                        <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
                        {b.code} · {b.name}
                      </span>
                    ) : null; })()}
                  </td>
                  <td className="px-5 py-3.5"><span className={`badge ${s.businessUnit === 'LEAD' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{s.businessUnit ?? 'AIRE'}</span></td>
                  <td className="px-5 py-3.5"><span className="badge bg-primary-50 text-primary-700">{t(CATEGORY_KEYS[s.category], CATEGORY_LABELS[s.category])}</span></td>
                  <td className="px-5 py-3.5 text-sm text-text-secondary">{categoryById(s.categoryId)?.name ?? <span className="text-text-muted">—</span>}</td>
                  <td className="px-5 py-3.5 text-xs">
                    {effectiveOutletIds(s).length === 0
                      ? <span className="badge bg-gray-100 text-gray-600 text-xs">{t('dash.services.allBranches', 'All branches')}</span>
                      : (
                        <span className="flex flex-wrap gap-1">
                          {effectiveOutletIds(s).map((id) => (
                            <span key={id} className="badge bg-sky-50 text-sky-700 text-xs">
                              {branches.find((b) => b.id === id)?.name ?? id.slice(0, 8)}
                            </span>
                          ))}
                        </span>
                      )}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-text-primary text-right font-mono">Rp {s.price.toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`badge ${s.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.isActive ? t('dash.services.active', 'Active') : t('dash.services.inactive', 'Inactive')}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setRecipeFor(s)}>{t('dash.services.recipe', 'Recipe')}</button>
                    <button className="btn-ghost text-xs" onClick={() => openEdit(s)}>{t('dash.services.edit', 'Edit')}</button>
                    <button className="btn-ghost text-xs text-error" onClick={() => handleDelete(s.id)}>{t('dash.services.delete', 'Delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ServiceModal
          initial={editing}
          categories={categories}
          brands={brands}
          branches={branches}
          categoryOptions={['car_wash', 'add_on']}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}

      {recipeFor && <RecipeModal service={recipeFor} onClose={() => setRecipeFor(null)} />}
    </div>
  );
}
